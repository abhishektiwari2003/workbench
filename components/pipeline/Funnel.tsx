"use client";

import { BOARDS } from "@/lib/board-list";
import type { FunnelState, StageKey } from "@/lib/funnel-state";
import { EXPLAIN_MAX } from "@/lib/schemas";
import type { Stage } from "@/lib/types";
import CountUp from "./CountUp";

const usd = (n: number) => `$${n.toFixed(4)}`;

const ROWS: { key: StageKey; label: string; detail: string; cost?: Stage; width: string }[] = [
  { key: "scanned", label: "Scanned", detail: "every open role", width: "100%" },
  { key: "prefiltered", label: "Pre-filtered", detail: "in code · free", width: "82%" },
  { key: "scored", label: "Scored", detail: "by Haiku", cost: "score", width: "64%" },
  { key: "explained", label: "Explained", detail: "by Sonnet", cost: "explain", width: "46%" },
];

function progress(state: FunnelState, key: StageKey): number {
  const s = state.stages[key];
  if (s.done) return 1;
  if (key === "scanned") return Object.values(state.boards).filter(Boolean).length / BOARDS.length;
  if (key === "scored") return s.count / Math.max(state.stages.prefiltered.count, 1);
  if (key === "explained") return s.count / EXPLAIN_MAX;
  return 0;
}

/** The live pipeline: boards tick off, then each stage fills, with a cost ticker per stage. Fixed layout: no jumps. */
export default function Funnel({ state }: { state: FunnelState }) {
  const active = ROWS.find((r) => !state.stages[r.key].done)?.key;
  return (
    <section aria-label="Live matching progress" className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">{state.cached ? "Replaying your last run" : "Matching live"}</h2>
        <p className="text-sm text-zinc-500">
          {state.cached ? "Served from cache · $0 spent · computed for " : "AI cost "}
          <span className="font-semibold text-zinc-900">
            <CountUp value={state.totalUsd} format={usd} />
          </span>
        </p>
      </div>

      <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5" aria-label="Job boards">
        {BOARDS.map((b, i) => {
          const s = state.boards[b.company];
          const tone = !s ? "text-zinc-500" : s.ok ? "text-zinc-900" : s.stale ? "text-amber-700" : "text-rose-700";
          return (
            <li
              key={b.company}
              style={{ transitionDelay: `${i * 40}ms` }}
              className={`flex items-center justify-between gap-1 rounded-lg px-2 py-1.5 text-sm ring-1 transition-colors duration-300 ${s?.ok ? "bg-emerald-50/60 ring-emerald-600/20" : s ? "bg-amber-50 ring-amber-500/30" : "bg-zinc-50 ring-zinc-200"} ${tone}`}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                {!s ? (
                  <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-zinc-400" aria-hidden />
                ) : (
                  <span className={s.ok ? "text-emerald-600" : ""} aria-hidden>
                    {s.ok ? "✓" : "!"}
                  </span>
                )}
                <span className="truncate">{b.company}</span>
              </span>
              <span className="shrink-0 tabular-nums text-zinc-500">{!s ? "" : s.ok ? s.count : s.stale ? "stale" : "down"}</span>
              <span className="sr-only">{!s ? "loading" : s.ok ? `${s.count} jobs` : s.stale ? "unavailable, using last known jobs" : "unavailable"}</span>
            </li>
          );
        })}
      </ul>

      <ol className="mt-6 space-y-3">
        {ROWS.map((r) => {
          const s = state.stages[r.key];
          const p = progress(state, r.key);
          return (
            <li key={r.key} className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-3 text-sm sm:grid-cols-[9rem_1fr_7rem]">
              <span>
                <span className="font-semibold">{r.label}</span>
                <span className="block text-zinc-500">{r.detail}</span>
              </span>
              <span className="block h-2.5" style={{ width: r.width, marginInline: "auto" }} aria-hidden>
                <span className="block h-full overflow-hidden rounded-full bg-zinc-100">
                  <span
                    className={`block h-full origin-left rounded-full bg-indigo-600 transition-transform duration-500 ease-out ${active === r.key && !state.finished ? "animate-pulse" : ""}`}
                    style={{ transform: `scaleX(${p})` }}
                  />
                </span>
              </span>
              <span className="text-right">
                <span className="block font-semibold">
                  <CountUp value={s.count} />
                </span>
                <span className="block text-zinc-500">{r.cost ? <CountUp value={state.cost[r.cost] ?? 0} format={usd} /> : "free"}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
