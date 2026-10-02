import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "./config";

export const COOKIE_NAME = "admin_session";
const MAX_AGE_S = 8 * 60 * 60;

const g = globalThis as unknown as { __devSecret?: string; __warned?: boolean };

function secret(): string {
  const s = env.sessionSecret();
  if (s) return s;
  if (env.isProd()) throw new Error("SESSION_SECRET must be set in production");
  return (g.__devSecret ??= randomBytes(32).toString("hex"));
}

function adminPassword(): string {
  const p = env.adminPassword();
  if (p) return p;
  if (env.isProd()) throw new Error("ADMIN_PASSWORD must be set in production");
  if (!g.__warned) {
    g.__warned = true;
    console.warn("[admin] ADMIN_PASSWORD not set; development default password is 'admin'.");
  }
  return "admin";
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function checkPassword(input: string): boolean {
  const expected = createHmac("sha256", "pw").update(adminPassword()).digest();
  const given = createHmac("sha256", "pw").update(input).digest();
  return timingSafeEqual(expected, given);
}

export function createToken(now = Date.now()): string {
  const exp = Math.floor(now / 1000) + MAX_AGE_S;
  return `${exp}.${sign(String(exp))}`;
}

export function verifyToken(token: string | undefined, now = Date.now()): boolean {
  if (!token) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || !safeEqual(sig, sign(exp))) return false;
  return Number(exp) > Math.floor(now / 1000);
}

export function sessionCookie(token: string): string {
  const secure = env.isProd() ? "; Secure" : "";
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${MAX_AGE_S}${secure}`;
}

export const clearCookie = `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;

export function isAdminRequest(req: Request): boolean {
  const cookie = req.headers.get("cookie") ?? "";
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  return verifyToken(m?.[1]);
}

export function unauthorized(): Response {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}
