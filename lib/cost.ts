// Per-request cost meter. Tracks what a result cost to compute (including calls served from the
// response cache, at their original price) separately from what this request actually spent.
import type { LLMUsage } from "./llm";
import { roundUsd, usdFor } from "./pricing";
import type { MatchCost, Stage } from "./types";

export type CostChange = { stage: Stage; stageUsd: number; totalUsd: number; cached: boolean };

export class CostMeter {
  private computeUsd = 0;
  private spentUsd = 0;
  private calls = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  private byStage: Partial<Record<Stage, number>> = {};

  constructor(private readonly onChange?: (c: CostChange) => void) {}

  /** Returns an `onUsage` callback for generateJSON that books the call under `stage`. */
  for(stage: Stage) {
    return (u: LLMUsage) => {
      const usd = usdFor(u);
      this.computeUsd += usd;
      if (!u.cached) this.spentUsd += usd;
      this.calls += 1;
      this.inputTokens += u.input + u.cacheRead + u.cacheWrite;
      this.outputTokens += u.output;
      this.byStage[stage] = (this.byStage[stage] ?? 0) + usd;
      this.onChange?.({ stage, stageUsd: roundUsd(this.byStage[stage]), totalUsd: roundUsd(this.computeUsd), cached: Boolean(u.cached) });
    };
  }

  total(): MatchCost {
    const byStage: Partial<Record<Stage, number>> = {};
    for (const [k, v] of Object.entries(this.byStage)) byStage[k as Stage] = roundUsd(v);
    return {
      computeUsd: roundUsd(this.computeUsd),
      spentUsd: roundUsd(this.spentUsd),
      calls: this.calls,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      byStage,
    };
  }
}
