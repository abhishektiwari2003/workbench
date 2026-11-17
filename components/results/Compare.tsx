"use client";

import { useEffect, useRef } from "react";
import { postedAgo } from "@/lib/filters";
import type { ScoredJob } from "@/lib/types";
import ScoreBars from "./ScoreBars";

export const COMPARE_MAX = 3;

/** Sticky bar that appears once jobs are ticked for comparison. */
export function CompareBar({ count, onOpen, onClear }: { count: number; onOpen: () => void; onClear: () => void }) {
  if (count === 0) return null;
  return (
    <div className="fade-in sticky bottom-4 z-10 mx-auto flex max-w-md items-center justify-between gap-3 rounded-2xl bg-zinc-900 px-4 py-3 text-sm text-white shadow-lg">
      <span>
        {count} selected{count < 2 ? " · pick at least 2" : ""}
      </span>
      <span className="flex items-center gap-2">
        <button type="button" onClick={onClear} className="rounded-lg px-2 py-1 text-zinc-300 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
          Clear
        </button>
        <button
          type="button"
          onClick={onOpen}
          disabled={count < 2}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 font-semibold transition-colors hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-50"
        >
          Compare
        </button>
      </span>
    </div>
  );
}

/** Side-by-side view in a native <dialog> (focus trap, Esc to close, no library). */
export function CompareDialog({ jobs, open, onClose }: { jobs: ScoredJob[]; open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="compare-title"
      className="m-auto w-[min(64rem,calc(100vw-2rem))] max-h-[calc(100vh-2rem)] rounded-2xl p-0 shadow-xl backdrop:bg-zinc-900/40"
    >
      <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4">
        <h2 id="compare-title" className="text-base font-semibold">
          Compare {jobs.length} roles
        </h2>
        <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-sm text-zinc-500 transition-colors hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600">
          Close
        </button>
      </div>
      <div className="overflow-x-auto p-6">
        <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${jobs.length}, minmax(15rem, 1fr))` }}>
          {jobs.map((m) => (
            <article key={m.job.id} className="space-y-3 rounded-xl border border-zinc-200 p-4 text-sm">
              <div>
                <p className="text-2xl font-semibold text-indigo-600">{m.score}</p>
                <h3 className="mt-1 font-semibold leading-snug">{m.job.title}</h3>
                <p className="text-zinc-500">
                  {m.job.company} · {m.tier === "strong" ? "Strong" : m.tier === "good" ? "Good" : "Closest"}
                </p>
              </div>
              <p>
                {m.locationFit.label}
                {m.locationFit.indiaFriendly ? " · India-friendly" : ""}
                {postedAgo(m.job.postedAt) ? ` · posted ${postedAgo(m.job.postedAt)}` : ""}
              </p>
              <ScoreBars breakdown={m.breakdown} compact />
              <ul className="space-y-1">
                {m.reasons.map((r, i) => (
                  <li key={i}>✓ {r}</li>
                ))}
                {m.gaps.map((g, i) => (
                  <li key={`g${i}`} className="text-zinc-500">
                    △ {g}
                  </li>
                ))}
              </ul>
              <a href={m.job.url} target="_blank" rel="noopener noreferrer" className="inline-block font-semibold text-indigo-600 hover:text-indigo-500">
                Apply →<span className="sr-only"> (opens in a new tab)</span>
              </a>
            </article>
          ))}
        </div>
      </div>
    </dialog>
  );
}
