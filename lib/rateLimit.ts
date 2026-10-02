const g = globalThis as unknown as { __rl?: Map<string, number[]> };
// Note: not shared across serverless instances; fine for a single-process demo.

/** Simple in-memory sliding-window limiter (per instance). Returns true if allowed. */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const store = (g.__rl ??= new Map<string, number[]>());
  const now = Date.now();
  const hits = (store.get(key) ?? []).filter((t: number) => now - t < windowMs);
  if (hits.length >= limit) {
    store.set(key, hits);
    return false;
  }
  hits.push(now);
  store.set(key, hits);
  return true;
}

export function clientKey(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
}
