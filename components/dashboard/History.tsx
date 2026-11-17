"use client";

import type { Me } from "./useMe";

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Quota, "new since your last visit", and the user's past runs (each reopens its saved result). */
export default function History({ me, currentId, onOpen }: { me: Me | null; currentId: string | null; onOpen: (id: string) => void }) {
  if (!me) return <div className="h-12 animate-pulse rounded-2xl bg-zinc-50" aria-hidden />;
  const { quota, runs, newJobsSinceLastVisit, newMatches } = me;
  return (
    <section aria-label="Your searches" className="space-y-3">
      {newJobsSinceLastVisit !== null && newJobsSinceLastVisit > 0 && (
        <p className="rounded-2xl border border-indigo-600/20 bg-indigo-50 px-6 py-3 text-sm text-indigo-700">
          <span className="font-semibold">{newJobsSinceLastVisit} new jobs</span> posted since your last visit. Run your search again to see
          which fit.
        </p>
      )}
      {newMatches.length > 0 && (
        <div className="rounded-2xl border border-emerald-600/20 bg-emerald-50/60 px-6 py-4 text-sm">
          <p className="font-semibold">
            {newMatches.length} new {newMatches.length === 1 ? "match" : "matches"} from the latest job refresh
          </p>
          <ul className="mt-2 space-y-1">
            {newMatches.slice(0, 5).map((m) => (
              <li key={m.job.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0">
                  <span className="font-semibold tabular-nums text-emerald-700">{m.score}</span> {m.job.company} · {m.job.title}{" "}
                  <span className="text-zinc-500">· {m.locationFit.label}</span>
                </span>
                <a href={m.job.url} target="_blank" rel="noopener noreferrer" className="rounded font-semibold text-indigo-600 hover:text-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600">
                  Apply<span className="sr-only"> to {m.job.title} (opens in a new tab)</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      <details className="group rounded-2xl border border-zinc-200 bg-zinc-50 px-6 py-3">
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600">
          <span className="font-semibold">
            My matches <span className="font-normal text-zinc-500">({runs.length})</span>
            <span className="ml-1 inline-block text-zinc-500 transition-transform group-open:rotate-90" aria-hidden>
              ›
            </span>
          </span>
          <span className="text-zinc-500">
            {quota.remaining} of {quota.limit} new searches left today · repeats are free
          </span>
        </summary>
        {runs.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">No searches yet. Your results will be listed here.</p>
        ) : (
          <ul className="mt-3 divide-y divide-zinc-200">
            {runs.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div className="min-w-0">
                  <p>
                    <span className="font-semibold">{when(r.createdAt)}</span> · {r.strong} strong · {r.good} good
                  </p>
                  <p className="truncate text-zinc-500">{r.top.map((t) => `${t.company} ${t.score}`).join(" · ") || "No matches"}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="tabular-nums text-zinc-500">{r.cached ? "cached · $0" : `$${r.computeUsd.toFixed(3)}`}</span>
                  <button
                    type="button"
                    onClick={() => onOpen(r.id)}
                    disabled={r.id === currentId}
                    className="rounded-lg px-2 py-1 font-semibold text-indigo-600 transition-colors hover:text-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 disabled:text-zinc-500"
                  >
                    {r.id === currentId ? "Showing" : "Open"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </details>
    </section>
  );
}
