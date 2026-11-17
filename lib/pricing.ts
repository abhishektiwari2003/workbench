// Token usage -> dollars. One place for prices so the cost meter, /ops and projections agree.

// USD per million tokens (Anthropic list prices). Cache write = 1.25x input (5-minute TTL).
export const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
};
const FALLBACK = PRICES["claude-sonnet-5-5"];

export type Usage = { model: string; input: number; output: number; cacheRead: number; cacheWrite: number };

export function usdFor(u: Usage): number {
  const p = PRICES[u.model] ?? FALLBACK;
  return (u.input * p.input + u.cacheWrite * p.input * 1.25 + u.cacheRead * p.cacheRead + u.output * p.output) / 1e6;
}

export function roundUsd(n: number): number {
  return Math.round(n * 100_000) / 100_000;
}
