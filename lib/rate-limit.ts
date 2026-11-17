// Fixed-window in-memory rate limiter. Per instance only:
// in production, back it with Redis (e.g. Upstash) using the same interface.
const windows = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit = 20, windowMs = 60_000) {
  const now = Date.now();
  const entry = windows.get(key);
  if (!entry || entry.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }
  entry.count++;
  if (entry.count > limit) {
    return { allowed: false, retryAfterSec: Math.ceil((entry.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfterSec: 0 };
}

export function clientKey(req: Request, route: string) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  return `${route}:${ip}`;
}
