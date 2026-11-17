// Fixed-window in-memory rate limiter. Per instance only:
// in production, back it with Redis (e.g. Upstash) using the same interface.
import { fail } from "./api";
import { singleton } from "./singleton";

/** Requests per minute. One place, so a new route can't silently pick its own number. */
export const LIMITS = {
  match: 10, // per user; ~7 LLM calls (~$0.035) each
  matchGlobal: 60, // per instance, all users: hard ceiling on LLM spend
  resume: 20,
  jobs: 60,
  jobsRefresh: 2,
  matchesGet: 60,
  copilot: 20, // fast-tier, ~$0.001 each
  simulate: 60, // free, deterministic
  feedback: 60,
  quality: 10, // smart tier, ~$0.015 each
  ops: 60,
} as const;

const MAX_KEYS = 10_000;
const windows = singleton("rate-limit", () => new Map<string, { count: number; resetAt: number }>());

function sweep(now: number) {
  for (const [key, entry] of windows) if (entry.resetAt <= now) windows.delete(key);
}

export function rateLimit(key: string, limit = 20, windowMs = 60_000) {
  const now = Date.now();
  if (windows.size >= MAX_KEYS) sweep(now); // keeps memory bounded under many distinct keys
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

/**
 * Client IP as set by the platform. `x-real-ip` (Vercel, nginx) first; otherwise the rightmost
 * x-forwarded-for entry, which our own proxy appends (the leftmost one is client-controlled).
 */
export function clientKey(req: Request, route: string) {
  const real = req.headers.get("x-real-ip")?.trim();
  const xff = req.headers.get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean);
  return `${route}:${real || xff?.at(-1) || "local"}`;
}

/** Applies a limit; returns a ready 429 (with Retry-After) or null when allowed. */
export function limitOr429(key: string, limit: number, message = "Too many requests.") {
  const r = rateLimit(key, limit);
  if (r.allowed) return null;
  const res = fail(429, "rate_limited", `${message} Try again in ${r.retryAfterSec}s.`);
  res.headers.set("retry-after", String(r.retryAfterSec));
  return res;
}
