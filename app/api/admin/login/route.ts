import { checkPassword, createToken, sessionCookie } from "@/lib/adminAuth";
import { clientKey, rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!rateLimit(`login:${clientKey(req)}`, 8, 60_000)) {
    return Response.json({ error: "Too many attempts. Try again shortly." }, { status: 429 });
  }
  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  try {
    if (!password || !checkPassword(password)) {
      return Response.json({ error: "Incorrect password" }, { status: 401 });
    }
    return Response.json({ ok: true }, { headers: { "Set-Cookie": sessionCookie(createToken()) } });
  } catch {
    return Response.json({ error: "Admin login is not configured on the server." }, { status: 500 });
  }
}
