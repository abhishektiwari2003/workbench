// Turns token usage into dollars, so every match result reports what it cost.
import type { LLMUsage } from "./llm";
import type { MatchCost } from "./schemas";

// USD per million tokens (Anthropic list prices). Cache write = 1.25x input (5-minute TTL).
const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
};
const FALLBACK = PRICES["claude-sonnet-5-5"];

export class CostMeter {
  private usd = 0;
  private calls = 0;
  private inputTokens = 0;
  private outputTokens = 0;

  /** Pass as `onUsage` to generateJSON. Cached responses never call it, so they cost $0. */
  readonly record = (u: LLMUsage) => {
    const p = PRICES[u.model] ?? FALLBACK;
    this.usd += (u.input * p.input + u.cacheWrite * p.input * 1.25 + u.cacheRead * p.cacheRead + u.output * p.output) / 1e6;
    this.calls += 1;
    this.inputTokens += u.input + u.cacheRead + u.cacheWrite;
    this.outputTokens += u.output;
  };

  total(): MatchCost {
    return {
      usd: Math.round(this.usd * 10_000) / 10_000,
      calls: this.calls,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
    };
  }
}
