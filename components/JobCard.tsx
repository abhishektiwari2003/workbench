import type { ScoredJob, Tier } from "@/lib/types";

// Spec score colours; text uses the 700 shade so it passes 4.5:1 on the tinted background.
const TONE: Record<Tier, string> = {
  strong: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  good: "bg-amber-50 text-amber-700 ring-amber-500/30",
  closest: "bg-rose-50 text-rose-700 ring-rose-600/20",
};

export default function JobCard({ match, closed }: { match: ScoredJob; closed: boolean }) {
  const { job, score, reasons, gaps, tier, locationFit } = match;
  return (
    <li className={`rounded-2xl border border-zinc-200 p-6 shadow-sm ${closed ? "bg-zinc-50" : "bg-white"}`}>
      <div className="flex items-start gap-4">
        <div
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-base font-semibold ring-1 ${closed ? "bg-zinc-100 text-zinc-700 ring-zinc-200" : TONE[tier]}`}
        >
          <span className="sr-only">Match score </span>
          {score}
          <span className="sr-only"> out of 100</span>
        </div>
        <div className="min-w-0 flex-1">
          <h3 className={`text-base font-semibold leading-snug ${closed ? "text-zinc-500 line-through" : ""}`}>{job.title}</h3>
          <p className="mt-1 text-sm text-zinc-500">
            {job.company} · {locationFit.label}
            {locationFit.indiaFriendly && <span className="ml-2 rounded bg-zinc-50 px-1.5 py-0.5 ring-1 ring-zinc-200">India-friendly</span>}
          </p>
          {closed && (
            <p className="mt-2 inline-block rounded-md bg-zinc-100 px-2 py-0.5 text-sm font-semibold text-zinc-700 ring-1 ring-zinc-200">
              Closed since your search
            </p>
          )}
        </div>
      </div>

      <ul className="mt-4 space-y-1 text-sm">
        {reasons.map((r, i) => (
          <li key={i} className="flex gap-2">
            <span className={closed ? "text-zinc-500" : "text-emerald-600"} aria-hidden>
              ✓
            </span>
            <span>{r}</span>
          </li>
        ))}
        {gaps.map((g, i) => (
          <li key={`g${i}`} className="flex gap-2 text-zinc-500">
            <span aria-hidden>△</span>
            <span>
              <span className="sr-only">Gap: </span>
              {g}
            </span>
          </li>
        ))}
      </ul>

      {!closed && (
        <a
          href={job.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-block rounded-lg text-sm font-semibold text-indigo-600 transition-colors hover:text-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
        >
          View and apply at {job.company} →<span className="sr-only"> (opens in a new tab)</span>
        </a>
      )}
    </li>
  );
}
