import { endSession, getSession } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { sessionId } = (await req.json().catch(() => ({}))) as { sessionId?: string };
  if (sessionId && getSession(sessionId)) endSession(sessionId);
  return Response.json({ ok: true });
}
