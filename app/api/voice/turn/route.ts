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

type Event =
  | { type: "transcript"; text: string }
  | { type: "reply"; text: string; wordCount: number; saved: { id: number } | null; state: ReturnType<typeof appointmentSnapshot> }
  | { type: "audio_chunk"; audio: string; mime: string }
  | { type: "audio_end" }
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
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: Event) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      const speak = async (text: string) => {
        for await (const chunk of synthesizeStream(text)) {
          send({ type: "audio_chunk", audio: chunk.toString("base64"), mime: "audio/mpeg" });
        }
        send({ type: "audio_end" });
      };

      try {
        await runExclusive(session, async () => {
          if (silence) {
            const text = await handleSilence(session);
            send({ type: "reply", text, wordCount: validateResponseLength(text).wordCount, saved: null, state: appointmentSnapshot(session) });
            await speak(text);
            return;
          }

          let userText = "";
          try {
            const buf = Buffer.from(await audio!.arrayBuffer());
            userText = await transcribe(buf, audio!.name || "speech.wav", audio!.type || "audio/wav");
          } catch (err) {
            console.error("[voice/turn] stt failed:", err instanceof Error ? err.name : "unknown");
            send({ type: "error", message: SPOKEN.connection });
            return;
          }

          if (isJunkTranscript(userText)) {
            const text = await handleUnclear(session);
            send({ type: "reply", text, wordCount: validateResponseLength(text).wordCount, saved: null, state: appointmentSnapshot(session) });
            await speak(text);
            return;
          }

          send({ type: "transcript", text: userText });
          const { reply, saved } = await handleUserTurn(session, userText, { llm: openAiLlm });
          send({
            type: "reply",
            text: reply,
            wordCount: validateResponseLength(reply).wordCount,
            saved: saved ? { id: saved.id } : null,
            state: appointmentSnapshot(session),
          });
          await speak(reply);
        });
      } catch (err) {
        console.error("[voice/turn] failed:", err instanceof Error ? err.name : "unknown");
        send({ type: "error", message: SPOKEN.connection });
      } finally {
        send({ type: "done" });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" },
  });
}
