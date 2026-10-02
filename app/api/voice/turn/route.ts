import { SPOKEN } from "@/lib/config";
import { openAiLlm, synthesizeStream, transcribe } from "@/lib/openai";
import {
  appointmentSnapshot,
  handleSilence,
  handleUnclear,
  handleUserTurn,
  isJunkTranscript,
} from "@/lib/receptionist";
import { getSession, runExclusive } from "@/lib/session";
import { clientKey, rateLimit } from "@/lib/rateLimit";
import { validateResponseLength } from "@/lib/responseLength";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

type Snapshot = ReturnType<typeof appointmentSnapshot>;
type Event =
  | { type: "transcript"; text: string }
  | { type: "reply_delta"; text: string }
  | { type: "state"; state: Snapshot }
  | { type: "reply"; text: string; wordCount: number; saved: { id: number } | null; state: Snapshot }
  | { type: "audio_chunk"; audio: string; mime: string }
  | { type: "audio_end" }
  | { type: "metrics"; marks: Record<string, number> }
  | { type: "error"; message: string }
  | { type: "done" };

export async function POST(req: Request) {
  if (!rateLimit(`turn:${clientKey(req)}`, 60, 60_000)) {
    return Response.json({ error: "Too many requests." }, { status: 429 });
  }

  let sessionId: string | null = null;
  let audio: File | null = null;
  let silence = false;
  try {
    const form = await req.formData();
    sessionId = String(form.get("sessionId") ?? "");
    silence = form.get("event") === "silence";
    const f = form.get("audio");
    if (f instanceof File) audio = f;
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }

  const session = getSession(sessionId);
  if (!session) return Response.json({ error: "Call session not found. Please start a new call." }, { status: 404 });
  if (!silence && (!audio || audio.size === 0)) return Response.json({ error: "No audio" }, { status: 400 });
  if (audio && audio.size > MAX_AUDIO_BYTES) return Response.json({ error: "Audio too large" }, { status: 413 });

  const encoder = new TextEncoder();
  let cancelled = false;
  const stream = new ReadableStream({
    cancel() {
      cancelled = true; // the browser aborted (barge-in / end call)
    },
    async start(controller) {
      const send = (e: Event) => {
        if (cancelled) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
        } catch {
          cancelled = true;
        }
      };

      // Timing marks (ms since request start). Contains no user content.
      const t0 = Date.now();
      const marks: Record<string, number> = {};
      const stamp = (k: string) => (marks[k] ??= Date.now() - t0);

      // Speech pipeline: each phrase starts synthesizing as soon as it is released (so phrase 2 is
      // usually ready before phrase 1 finishes playing), while audio is sent strictly in order.
      type Job = { chunks: Buffer[]; done: boolean };
      const jobs: Job[] = [];
      let closed = false;
      let spokeAny = false;
      let ttsFailed = false;
      let notify: () => void = () => {};
      const wait = () => new Promise<void>((r) => (notify = r));

      const queueSpeech = (text: string) => {
        spokeAny = true;
        stamp("firstChunk");
        const job: Job = { chunks: [], done: false };
        jobs.push(job);
        notify();
        void (async () => {
          stamp("ttsStart");
          try {
            for await (const chunk of synthesizeStream(text)) {
              stamp("ttsFirstByte");
              job.chunks.push(chunk);
              notify();
            }
          } catch (err) {
            if (!ttsFailed) {
              ttsFailed = true;
              console.error("[voice/turn] tts failed:", err instanceof Error ? err.name : "unknown");
              send({ type: "error", message: SPOKEN.connection });
            }
          } finally {
            job.done = true;
            notify();
          }
        })();
      };

      const emitAudio = async () => {
        let i = 0;
        let sent = 0;
        while (!cancelled) {
          const job = jobs[i];
          if (!job) {
            if (closed) return;
            await wait();
          } else if (sent < job.chunks.length) {
            send({ type: "audio_chunk", audio: job.chunks[sent++].toString("base64"), mime: "audio/mpeg" });
          } else if (job.done) {
            i++;
            sent = 0;
          } else {
            await wait();
          }
        }
      };
      const emitter = emitAudio();

      const sendReply = (text: string, saved: { id: number } | null) =>
        send({
          type: "reply",
          text,
          wordCount: validateResponseLength(text).wordCount,
          saved,
          state: appointmentSnapshot(session),
        });

      try {
        await runExclusive(session, async () => {
          if (silence) {
            const text = await handleSilence(session);
            sendReply(text, null);
            queueSpeech(text);
            return;
          }

          let userText = "";
          try {
            const buf = Buffer.from(await audio!.arrayBuffer());
            userText = await transcribe(buf, audio!.name || "speech.wav", audio!.type || "audio/wav");
            stamp("stt");
          } catch (err) {
            console.error("[voice/turn] stt failed:", err instanceof Error ? err.name : "unknown");
            send({ type: "error", message: SPOKEN.connection });
            return;
          }

          if (isJunkTranscript(userText)) {
            const text = await handleUnclear(session);
            sendReply(text, null);
            queueSpeech(text);
            return;
          }

          send({ type: "transcript", text: userText });
          const { reply, saved } = await handleUserTurn(session, userText, {
            llm: openAiLlm,
            onText: (text) => {
              stamp("firstToken");
              send({ type: "reply_delta", text });
            },
            onSpeak: queueSpeech,
            onState: () => send({ type: "state", state: appointmentSnapshot(session) }),
          });
          stamp("llmDone");
          sendReply(reply, saved ? { id: saved.id } : null);
          if (!spokeAny) queueSpeech(reply);
        });
        closed = true;
        notify();
        await emitter;
        send({ type: "audio_end" });
        stamp("end");
        send({ type: "metrics", marks });
        if (process.env.VOICE_TIMING) console.log("[timing ms]", JSON.stringify(marks));
        // Let the background transcript save finish (bounded) before closing the stream.
        await Promise.race([session.persistChain, new Promise((r) => setTimeout(r, 3000))]);
      } catch (err) {
        console.error("[voice/turn] failed:", err instanceof Error ? err.name : "unknown");
        send({ type: "error", message: SPOKEN.connection });
      } finally {
        closed = true;
        notify();
        send({ type: "done" });
        try {
          controller.close();
        } catch {
          /* already closed by cancel */
        }
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" },
  });
}
