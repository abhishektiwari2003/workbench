// Process-wide counters for the /ops page: LLM calls per stage, cache hit rates, board health,
// and cost per candidate. In production these become Prometheus/OpenTelemetry metrics.
import { usdFor, type Usage } from "./pricing";
import type { BoardStatus, MatchResult, Stage } from "./types";
import { singleton } from "./singleton";

type LlmStat = { calls: number; cachedCalls: number; input: number; output: number; usd: number };
type CacheStat = { hits: number; misses: number };
type BoardStat = BoardStatus & { checkedAt: string };

const llm = singleton("m-llm", () => new Map<string, LlmStat>()); // keyed by call label, e.g. "match-score"
const caches = singleton("m-caches", () => new Map<string, CacheStat>()); // "llm" | "result" | "digest"
const boards = singleton("m-boards", () => new Map<string, BoardStat>());
const candidates = singleton("m-candidates", () => ({ fresh: 0, cached: 0, computeUsd: 0, spentUsd: 0 }));
const today = singleton("m-today", () => ({ day: new Date().toISOString().slice(0, 10), spentUsd: 0 }));

function rollDay() {
  const day = new Date().toISOString().slice(0, 10);
  if (today.day !== day) Object.assign(today, { day, spentUsd: 0 });
}

export function recordLlm(label: string, usage: Usage, cached: boolean) {
  const s = llm.get(label) ?? { calls: 0, cachedCalls: 0, input: 0, output: 0, usd: 0 };
  const usd = usdFor(usage);
  if (cached) s.cachedCalls += 1;
  else {
    s.calls += 1;
    s.input += usage.input + usage.cacheRead + usage.cacheWrite;
    s.output += usage.output;
    s.usd += usd;
    rollDay();
    today.spentUsd += usd;
  }
  llm.set(label, s);
}

export function recordCache(name: string, hit: boolean) {
  const s = caches.get(name) ?? { hits: 0, misses: 0 };
  if (hit) s.hits += 1;
  else s.misses += 1;
  caches.set(name, s);
}

export function recordBoard(b: BoardStatus) {
  boards.set(b.company, { ...b, checkedAt: new Date().toISOString() });
}

type RunRecord = { at: number; computeUsd: number; byStage: Partial<Record<Stage, number>>; digestCached: number; digestComputed: number };
const runs = singleton("m-runs", () => [] as RunRecord[]); // recent fresh runs, for per-stage averages
const MAX_RUNS = 500;

export function recordCandidate(r: MatchResult) {
  candidates.spentUsd += r.cost.spentUsd;
  if (r.servedFromCache) {
    candidates.cached += 1;
    return;
  }
  candidates.fresh += 1;
  candidates.computeUsd += r.cost.computeUsd;
  runs.push({ at: Date.now(), computeUsd: r.cost.computeUsd, byStage: r.cost.byStage, digestCached: r.digests?.cached ?? 0, digestComputed: r.digests?.computed ?? 0 });
  if (runs.length > MAX_RUNS) runs.shift();
}

const quality = singleton("m-quality", () => ({ checks: 0, agreement: 0, precisionAt5: 0, falseNegativeRate: 0 }));

/** Running totals of quality-panel checks, averaged on /ops. */
export function recordQuality(agreement: number, precisionAt5: number, falseNegativeRate: number) {
  quality.checks += 1;
  quality.agreement += agreement;
  quality.precisionAt5 += precisionAt5;
  quality.falseNegativeRate += falseNegativeRate;
}

export function metricsSnapshot() {
  rollDay();
  return {
    llm: Object.fromEntries(llm),
    caches: Object.fromEntries(caches),
    boards: [...boards.values()],
    candidates: { ...candidates, avgComputeUsd: candidates.fresh ? candidates.computeUsd / candidates.fresh : 0 },
    runs: [...runs],
    quality: quality.checks
      ? {
          checks: quality.checks,
          agreement: quality.agreement / quality.checks,
          precisionAt5: quality.precisionAt5 / quality.checks,
          falseNegativeRate: quality.falseNegativeRate / quality.checks,
        }
      : null,
    today: { ...today },
  };
}
