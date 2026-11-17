"use client";

import { useState } from "react";
import { callApi } from "@/lib/client-api";
import { CostChip, Spinner } from "./CostChip";

type Item = { id: string; title: string; company: string; ours: "match" | "rejected"; ourScore: number; verdict: "apply" | "skip"; reason: string; agrees: boolean };
type Report = { agreement: number; precisionAt5: number; falseNegativeRate: number; costUsd: number; cached: boolean; items: Item[] };

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** On demand: an independent smart-tier judge grades 5 matches and 5 rejected jobs. */
export default function QualityPanel({ resultId }: { resultId: string }) {
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    const r = await callApi<Report>("/api/quality", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ resultId }) });
    setBusy(false);
    if (!r.ok) return setError(r.message);
    setReport(r.data);
  }

  return (
    <section aria-labelledby="quality-title" className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="quality-title" className="text-base font-semibold">Is the matching any good?</h2>
          <p className="mt-1 text-sm text-zinc-500">Sonnet independently judges 5 of your matches and the 5 closest jobs we rejected, without seeing our scores.</p>
        </div>
        {!report && (
          <button
            type="button"
            onClick={run}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-semibold ring-1 ring-zinc-200 transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 disabled:opacity-60"
          >
            {busy && <Spinner />}
            {busy ? "Judging..." : "Check quality · ~$0.015"}
          </button>
        )}
      </div>
      {busy && <div className="mt-4 h-40 animate-pulse rounded-lg bg-zinc-100" aria-hidden />}
      {error && <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p>}
      {report && (
        <div className="fade-in mt-4 space-y-4" aria-live="polite">
          <dl className="grid grid-cols-3 gap-3 text-sm">
            {[
              ["Agreement", report.agreement, "same call on all 10"],
              ["Precision of top 5", report.precisionAt5, "our matches the judge would apply to"],
              ["False negatives", report.falseNegativeRate, "rejected jobs the judge would apply to"],
            ].map(([label, v, note]) => (
              <div key={label as string} className="rounded-lg bg-zinc-50 p-3">
                <dt className="text-zinc-500">{label as string}</dt>
                <dd className="text-2xl font-semibold tabular-nums">{pct(v as number)}</dd>
                <dd className="text-zinc-500">{note as string}</dd>
              </div>
            ))}
          </dl>
          <ul className="divide-y divide-zinc-100 text-sm">
            {report.items.map((i) => (
              <li key={i.id} className="flex gap-3 py-2">
                <span className={`w-5 shrink-0 ${i.agrees ? "text-emerald-600" : "text-rose-700"}`} aria-hidden>
                  {i.agrees ? "✓" : "✗"}
                </span>
                <div className="min-w-0">
                  <p>
                    <span className="font-semibold">{i.company}</span> · {i.title}
                  </p>
                  <p className="text-zinc-500">
                    We: {i.ours === "match" ? `match (${i.ourScore})` : `rejected (${i.ourScore})`} · Judge: {i.verdict} · {i.reason}
                    <span className="sr-only">{i.agrees ? ". Agrees." : ". Disagrees."}</span>
                  </p>
                </div>
              </li>
            ))}
          </ul>
          <CostChip usd={report.costUsd} cached={report.cached} />
        </div>
      )}
    </section>
  );
}
