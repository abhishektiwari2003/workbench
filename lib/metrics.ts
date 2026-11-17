// Process-wide counters for the /ops page: LLM calls per stage, cache hit rates, board health,
// and cost per candidate. In production these become Prometheus/OpenTelemetry metrics.
import { usdFor, type Usage } from "./pricing";
import type { BoardStatus } from "./types";

type LlmStat = { calls: number; cachedCalls: number; input: number; output: number; usd: number };
type CacheStat = { hits: number; misses: number };
type BoardStat = BoardStatus & { checkedAt: string };

const llm = new Map<string, LlmStat>(); // keyed by call label, e.g. "match-score"
const caches = new Map<string, CacheStat>(); // "llm" | "result" | "digest"
const boards = new Map<string, BoardStat>();
const candidates = { fresh: 0, cached: 0, computeUsd: 0, spentUsd: 0 };
let today = { day: new Date().toISOString().slice(0, 10), spentUsd: 0 };

function rollDay() {
  const day = new Date().toISOString().slice(0, 10);
  if (today.day !== day) today = { day, spentUsd: 0 };
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

export function recordCandidate(computeUsd: number, spentUsd: number, cached: boolean) {
  if (cached) candidates.cached += 1;
  else candidates.fresh += 1;
  candidates.computeUsd += cached ? 0 : computeUsd;
  candidates.spentUsd += spentUsd;
}

export function metricsSnapshot() {
  rollDay();
  return {
    llm: Object.fromEntries(llm),
    caches: Object.fromEntries(caches),
    boards: [...boards.values()],
    candidates: { ...candidates, avgComputeUsd: candidates.fresh ? candidates.computeUsd / candidates.fresh : 0 },
    today: { ...today },
  };
}
