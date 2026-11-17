// Runtime plumbing for lib/llm.ts: errors, concurrency limit, response cache, JSON extraction, logging.
import Anthropic from "@anthropic-ai/sdk";
import type { Usage } from "./pricing";

export type LLMErrorKind = "config" | "timeout" | "rate_limit" | "overloaded" | "api" | "parse";

export class LLMError extends Error {
  constructor(message: string, public readonly kind: LLMErrorKind) {
    super(message);
    this.name = "LLMError";
  }
}

/** Maps an LLMError to an HTTP status for API routes. */
export function llmErrorStatus(err: LLMError): number {
  switch (err.kind) {
    case "timeout":
      return 504;
    case "rate_limit":
      return 429;
    case "overloaded":
      return 503;
    case "parse":
    case "api":
      return 502;
    default:
      return 500;
  }
}

export function toLLMError(err: unknown): LLMError {
  if (err instanceof LLMError) return err;
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new LLMError("The model took too long to respond", "timeout");
  if (err instanceof Anthropic.APIUserAbortError) return new LLMError("The request deadline passed", "timeout");
  if (err instanceof Anthropic.RateLimitError) return new LLMError("Too many requests right now, please retry shortly", "rate_limit");
  if (err instanceof Anthropic.APIError) {
    if (err.status === 529) return new LLMError("The model is busy, please retry", "overloaded");
    return new LLMError(`Model provider error (${err.status ?? "network"})`, "api");
  }
  return new LLMError("Unexpected error calling the model", "api");
}

// ---- Concurrency limit: protects rate limits and cost under bursts ----
const MAX_CONCURRENT = Number(process.env.LLM_MAX_CONCURRENT ?? 8);
const MAX_QUEUE = Number(process.env.LLM_MAX_QUEUE ?? 100); // beyond this, fail fast as "overloaded"
let active = 0;
const waiting: Array<() => void> = [];

export async function withSlot<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const mustWait = active >= MAX_CONCURRENT;
  if (mustWait) {
    if (waiting.length >= MAX_QUEUE) throw new LLMError("Too many queued model calls", "overloaded");
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  if (signal?.aborted) {
    if (mustWait) waiting.shift()?.(); // hand the freed slot to the next caller
    throw new LLMError("Request deadline passed while queued", "timeout");
  }
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

// ---- Response cache: identical requests are free and instant ----
// Each entry keeps the usage of the call that produced it, so a cached answer still reports what it
// cost to compute. In production, swap this Map for Redis with the same key.
const CACHE_TTL_MS = Number(process.env.LLM_CACHE_TTL_MS ?? 30 * 60_000);
const CACHE_MAX_ENTRIES = 2_000;
type Entry = { value: unknown; usage: Usage[]; expires: number };
const cache = new Map<string, Entry>();

export function cacheGet(key: string): Entry | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (hit.expires < Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return hit;
}

export function cacheSet(key: string, value: unknown, usage: Usage[]) {
  if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  cache.set(key, { value, usage, expires: Date.now() + CACHE_TTL_MS });
}

export function extractJSON(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return undefined;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

/** One structured line per call: enough to track cost and latency per feature. */
export function logUsage(label: string, usage: Usage, ms: number) {
  console.info(
    JSON.stringify({
      evt: "llm_call",
      label,
      model: usage.model,
      ms,
      in: usage.input,
      out: usage.output,
      cache_read: usage.cacheRead,
      cache_write: usage.cacheWrite,
    }),
  );
}
