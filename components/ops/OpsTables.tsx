import type { BoardStatus } from "@/lib/types";

export type LlmStat = { calls: number; cachedCalls: number; input: number; output: number; usd: number };
export type Projection = {
  coldUsd: number;
  warmUsd: number;
  digestPerJobUsd: number;
  sharedMonthlyUsd: number;
  measured: { coldRuns: number; warmRuns: number; digestedJobs: number };
  assumptions: { repeatShare: number; monthlyChurn: number };
  rows: { candidates: number; withoutSharing: number; withSharing: number; perCandidate: number; saving: number }[];
};

const usd = (n: number, d = 4) => `$${n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const card = "rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm";
const th = "py-2 pr-4 text-left font-normal text-zinc-500";
const td = "py-2 pr-4 tabular-nums";

export function BoardsTable({ boards }: { boards: (BoardStatus & { checkedAt?: string })[] }) {
  return (
    <section className={card} aria-labelledby="ops-boards">
      <h2 id="ops-boards" className="text-base font-semibold">Board health</h2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200"><th className={th}>Board</th><th className={th}>Status</th><th className={th}>Jobs</th><th className={th}>Latency</th></tr>
          </thead>
          <tbody>
            {boards.map((b) => (
              <tr key={b.company} className="border-b border-zinc-100 last:border-0">
                <td className="py-2 pr-4">{b.company}</td>
                <td className={`py-2 pr-4 ${b.ok ? "text-emerald-700" : "text-amber-700"}`}>{b.ok ? "OK" : b.stale ? "Down · stale" : "Down"}</td>
                <td className={td}>{b.count.toLocaleString()}</td>
                <td className={td}>{b.ms !== undefined ? `${b.ms.toLocaleString()} ms` : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function StagesTable({ llm }: { llm: Record<string, LlmStat> }) {
  const rows = Object.entries(llm).sort(([, a], [, b]) => b.usd - a.usd);
  return (
    <section className={card} aria-labelledby="ops-stages">
      <h2 id="ops-stages" className="text-base font-semibold">LLM calls by stage</h2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200"><th className={th}>Stage</th><th className={th}>Calls</th><th className={th}>Cache hits</th><th className={th}>Tokens in / out</th><th className={th}>Cost</th></tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td className="py-2 text-zinc-500" colSpan={5}>No model calls yet.</td></tr>}
            {rows.map(([label, s]) => (
              <tr key={label} className="border-b border-zinc-100 last:border-0">
                <td className="py-2 pr-4">{label}</td>
                <td className={td}>{s.calls}</td>
                <td className={td}>{s.cachedCalls}</td>
                <td className={td}>{s.input.toLocaleString()} / {s.output.toLocaleString()}</td>
                <td className={td}>{usd(s.usd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function ProjectionTable({ p }: { p: Projection }) {
  return (
    <section className={card} aria-labelledby="ops-projection">
      <h2 id="ops-projection" className="text-base font-semibold">Monthly LLM cost at scale</h2>
      <p className="mt-1 text-sm text-zinc-500">
        Cold run {usd(p.coldUsd)} ({p.measured.coldRuns ? `measured over ${p.measured.coldRuns}` : "default"}) · warm-digest run {usd(p.warmUsd)} (
        {p.measured.warmRuns ? `measured over ${p.measured.warmRuns}` : "default"}) · digest {usd(p.digestPerJobUsd, 5)} per job, shared platform cost{" "}
        {usd(p.sharedMonthlyUsd, 2)}/month. Assumes {Math.round(p.assumptions.repeatShare * 100)}% repeat searches and{" "}
        {Math.round(p.assumptions.monthlyChurn * 100)}% monthly job churn.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200"><th className={th}>Candidates / month</th><th className={th}>No shared caches</th><th className={th}>With shared caches</th><th className={th}>Per candidate</th><th className={th}>Saving</th></tr>
          </thead>
          <tbody>
            {p.rows.map((r) => (
              <tr key={r.candidates} className="border-b border-zinc-100 last:border-0">
                <td className="py-2 pr-4">{r.candidates.toLocaleString()}</td>
                <td className={td}>{usd(r.withoutSharing, 0)}</td>
                <td className={`${td} font-semibold`}>{usd(r.withSharing, 0)}</td>
                <td className={td}>{usd(r.perCandidate)}</td>
                <td className={`${td} text-emerald-700`}>{Math.round(r.saving * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
