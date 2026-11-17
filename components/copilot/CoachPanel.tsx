"use client";

import { useState } from "react";
import { callApi } from "@/lib/client-api";
import { CostChip, scrollToJob, Spinner } from "./CostChip";

type Change = { change: string; why: string; addSkills: string[]; addTitles: string[]; jobs: { id: string; title: string; company: string }[] };
type CoachOut = { output: { changes: Change[] }; costUsd: number; cached: boolean };
type SimOut = { before: number; after: number; added: number; examples: { id: string; title: string; company: string; location: string }[] };

const btn =
  "inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 disabled:cursor-not-allowed disabled:opacity-60";

/** Resume coach: top 3 changes from gaps across the top 20 matches, and a free "what if" simulation. */
export default function CoachPanel({ resultId, shownIds }: { resultId: string; shownIds: Set<string> }) {
  const [coach, setCoach] = useState<CoachOut | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [sim, setSim] = useState<SimOut | null>(null);
  const [busy, setBusy] = useState<"coach" | "sim" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function getCoach() {
    setBusy("coach");
    setError(null);
    const r = await callApi<CoachOut>("/api/copilot", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "coach", resultId }) });
    setBusy(null);
    if (!r.ok) return setError(r.message);
    setCoach(r.data);
    setPicked(r.data.output.changes.map((_, i) => i));
    setSim(null);
  }

  async function simulate() {
    if (!coach) return;
    const chosen = picked.map((i) => coach.output.changes[i]);
    setBusy("sim");
    setError(null);
    const r = await callApi<SimOut>("/api/copilot/simulate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resultId, addSkills: chosen.flatMap((c) => c.addSkills), addTitles: chosen.flatMap((c) => c.addTitles) }),
    });
    setBusy(null);
    if (!r.ok) return setError(r.message);
    setSim(r.data);
  }

  return (
    <section aria-labelledby="coach-title" className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="coach-title" className="text-base font-semibold">Resume coach</h2>
          <p className="mt-1 text-sm text-zinc-500">The 3 resume changes that would unlock the most of your top 20 matches.</p>
        </div>
        {!coach && (
          <button type="button" onClick={getCoach} disabled={busy !== null} className={`${btn} bg-indigo-600 text-white hover:bg-indigo-500`}>
            {busy === "coach" && <Spinner light />}
            {busy === "coach" ? "Thinking..." : "Get suggestions · ~$0.001"}
          </button>
        )}
      </div>

      {busy === "coach" && (
        <div className="mt-4 space-y-3" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-zinc-100" />
          ))}
        </div>
      )}

      {coach && (
        <>
          <ol className="mt-4 space-y-3">
            {coach.output.changes.map((c, i) => (
              <li key={i} className="flex gap-3 rounded-lg p-3 ring-1 ring-zinc-200">
                <input
                  type="checkbox"
                  aria-label={`Include change ${i + 1} in the simulation`}
                  checked={picked.includes(i)}
                  onChange={() => setPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : [...p, i]))}
                  className="mt-1 h-4 w-4 shrink-0 rounded accent-indigo-600"
                />
                <div className="min-w-0 text-sm">
                  <p className="font-semibold">{c.change}</p>
                  <p className="mt-0.5 text-zinc-500">{c.why}</p>
                  {c.jobs.length > 0 && (
                    <p className="mt-1 text-zinc-500">
                      Unlocks:{" "}
                      {c.jobs.map((j, k) => (
                        <span key={j.id}>
                          {k > 0 && ", "}
                          {shownIds.has(j.id) ? (
                            <button type="button" onClick={() => scrollToJob(j.id)} className="rounded text-indigo-600 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600">
                              {j.company} · {j.title}
                            </button>
                          ) : (
                            `${j.company} · ${j.title}`
                          )}
                        </span>
                      ))}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" onClick={simulate} disabled={busy !== null || picked.length === 0} className={`${btn} ring-1 ring-zinc-200 hover:bg-zinc-50`}>
              {busy === "sim" && <Spinner />}
              Simulate selected · free
            </button>
            <CostChip usd={coach.costUsd} cached={coach.cached} />
          </div>
          {sim && (
            <div className="fade-in mt-4 rounded-lg bg-zinc-50 p-4 text-sm" aria-live="polite">
              <p>
                <span className="text-2xl font-semibold text-indigo-600">+{sim.added}</span> more{" "}
                {sim.added === 1 ? "job" : "jobs"} would qualify for AI review ({sim.after} vs {sim.before} today). Computed in code, $0.
              </p>
              {sim.examples.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-zinc-500">
                  {sim.examples.map((e) => (
                    <li key={e.id}>
                      {e.company} · {e.title} · {e.location}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-rose-700">
          {error}
        </p>
      )}
    </section>
  );
}
