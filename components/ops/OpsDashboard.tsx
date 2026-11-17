"use client";

import { useCallback, useEffect, useState } from "react";
import { callApi } from "@/lib/client-api";
import type { BoardStatus } from "@/lib/types";
import { Spinner } from "../copilot/CostChip";
import { BoardsTable, ProjectionTable, StagesTable, type LlmStat, type Projection } from "./OpsTables";

type Ops = {
  llm: Record<string, LlmStat>;
  caches: Record<string, { hits: number; misses: number }>;
  boards: (BoardStatus & { checkedAt: string })[];
  candidates: { fresh: number; cached: number; avgComputeUsd: number; spentUsd: number };
  today: { day: string; spentUsd: number };
  quality: { checks: number; agreement: number; precisionAt5: number; falseNegativeRate: number } | null;
  jobs: { total: number; fetchedAt: string | null };
  digests: { cached: number; coverage: number };
  projection: Projection;
};
type Refresh = { total: number; added: number; closed: number; simulated: number; usersChecked: number; jobsRescored: number; newMatches: number; costUsd: number };

const pct = (c?: { hits: number; misses: number }) => (c && c.hits + c.misses ? `${Math.round((c.hits / (c.hits + c.misses)) * 100)}%` : "-");

function Kpi({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
      <p className="text-sm text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {note && <p className="text-sm text-zinc-500">{note}</p>}
    </div>
  );
}

export default function OpsDashboard() {
  const [ops, setOps] = useState<Ops | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"refresh" | "simulate" | null>(null);
  const [report, setReport] = useState<Refresh | null>(null);

  const load = useCallback(async () => {
    const r = await callApi<Ops>("/api/ops");
    if (r.ok) setOps(r.data);
    else setError(r.message);
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
    load();
  }, [load]);

  async function refresh(simulate: boolean) {
    setBusy(simulate ? "simulate" : "refresh");
    setError(null);
    const r = await callApi<Refresh>(`/api/refresh${simulate ? "?simulate=5" : ""}`, { method: "POST" });
    setBusy(null);
    if (!r.ok) return setError(r.message);
    setReport(r.data);
    load();
  }

  if (!ops) return error ? <p role="alert" className="text-sm text-rose-700">{error}</p> : <div className="h-96 animate-pulse rounded-2xl bg-zinc-50" aria-hidden />;
  const btn = "inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 disabled:opacity-60";
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Ops</h1>
          <p className="text-sm text-zinc-500">
            {ops.jobs.total.toLocaleString()} jobs · snapshot {ops.jobs.fetchedAt ? new Date(ops.jobs.fetchedAt).toLocaleTimeString() : "not loaded"} · this process since start
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => refresh(false)} disabled={busy !== null} className={`${btn} bg-indigo-600 text-white hover:bg-indigo-500`}>
            {busy === "refresh" && <Spinner light />}Run refresh now
          </button>
          <button type="button" onClick={() => refresh(true)} disabled={busy !== null} className={`${btn} ring-1 ring-zinc-200 hover:bg-zinc-50`} title="Dev only: treat 5 plausible jobs as newly posted">
            {busy === "simulate" && <Spinner />}Simulate 5 new jobs
          </button>
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      {report && (
        <p className="fade-in rounded-2xl border border-zinc-200 bg-zinc-50 px-6 py-3 text-sm" aria-live="polite">
          Refresh: {report.added} new{report.simulated ? ` (${report.simulated} simulated)` : ""} · {report.closed} closed · {report.usersChecked} users
          checked · {report.jobsRescored} jobs re-scored · <span className="font-semibold">{report.newMatches} new matches</span> · ${report.costUsd.toFixed(4)}
        </p>
      )}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Kpi label="Spent today" value={`$${ops.today.spentUsd.toFixed(3)}`} />
        <Kpi label="Avg per candidate" value={`$${ops.candidates.avgComputeUsd.toFixed(4)}`} note={`${ops.candidates.fresh} fresh · ${ops.candidates.cached} cached`} />
        <Kpi label="Result cache" value={pct(ops.caches.result)} note={`LLM cache ${pct(ops.caches.llm)}`} />
        <Kpi label="Job digests" value={pct(ops.caches.digest)} note={`${ops.digests.cached.toLocaleString()} cached · ${Math.round(ops.digests.coverage * 100)}% of jobs`} />
      </div>
      {ops.quality && (
        <div className="grid grid-cols-3 gap-4">
          <Kpi label="Judge agreement" value={`${Math.round(ops.quality.agreement * 100)}%`} note={`${ops.quality.checks} checks`} />
          <Kpi label="Precision of top 5" value={`${Math.round(ops.quality.precisionAt5 * 100)}%`} />
          <Kpi label="False-negative rate" value={`${Math.round(ops.quality.falseNegativeRate * 100)}%`} />
        </div>
      )}
      <ProjectionTable p={ops.projection} />
      <StagesTable llm={ops.llm} />
      <BoardsTable boards={ops.boards} />
    </div>
  );
}
