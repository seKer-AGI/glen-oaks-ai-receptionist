import { clearCookie } from "@/lib/adminAuth";

export async function POST() {
  return Response.json({ ok: true }, { headers: { "Set-Cookie": clearCookie } });
}
