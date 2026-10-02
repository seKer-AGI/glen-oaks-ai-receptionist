import { GREETING, SPOKEN, ConfigError } from "@/lib/config";
import { greet } from "@/lib/receptionist";
import { createSession, endSession } from "@/lib/session";
import { isOpenAIConfigured, synthesize } from "@/lib/openai";
import { clientKey, rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The greeting never changes, so synthesize it once per server process.
const cache = globalThis as unknown as { __greetingAudio?: Buffer };

export async function POST(req: Request) {
  if (!rateLimit(`start:${clientKey(req)}`, 20, 60_000)) {
    return Response.json({ error: "Too many calls. Please wait a moment." }, { status: 429 });
  }
  if (!isOpenAIConfigured()) {
    return Response.json(
      { error: "The receptionist is not configured yet (missing OPENAI_API_KEY)." },
      { status: 503 },
    );
  }
  const session = createSession();
  try {
    const audio = (cache.__greetingAudio ??= await synthesize(GREETING));
    await greet(session, GREETING);
    return Response.json({
      sessionId: session.id,
      greeting: GREETING,
      audio: audio.toString("base64"),
      mime: "audio/mpeg",
    });
  } catch (err) {
    endSession(session.id);
    console.error("[voice/start] failed:", err instanceof Error ? `${err.name}: ${err.message.slice(0, 200)}` : "unknown");
    const status = err instanceof ConfigError ? 503 : 502;
    return Response.json({ error: SPOKEN.connection }, { status });
  }
}
