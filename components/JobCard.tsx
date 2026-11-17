import type { ReactNode } from "react";
import { postedAgo } from "@/lib/filters";
import type { ScoredJob, Tier } from "@/lib/types";
import ScoreBars from "./results/ScoreBars";

// Spec score colours; text uses the 700 shade so it passes 4.5:1 on the tinted background.
const TONE: Record<Tier, string> = {
  strong: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  good: "bg-amber-50 text-amber-700 ring-amber-500/30",
  closest: "bg-rose-50 text-rose-700 ring-rose-600/20",
};

type Props = {
  match: ScoredJob;
  closed: boolean;
  selected?: boolean;
  compareDisabled?: boolean;
  onToggleCompare?: () => void;
  actions?: ReactNode; // copilot buttons, feedback
};

export default function JobCard({ match, closed, selected = false, compareDisabled = false, onToggleCompare, actions }: Props) {
  const { job, score, reasons, gaps, tier, locationFit, breakdown } = match;
  const posted = postedAgo(job.postedAt);
  return (
    <li
      id={`job-${job.id}`}
      tabIndex={-1}
      className={`scroll-mt-4 rounded-2xl border p-6 shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 ${selected ? "border-indigo-600" : "border-zinc-200"} ${closed ? "bg-zinc-50" : "bg-white"}`}
    >
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
            {posted ? ` · posted ${posted}` : ""}
          </p>
          {locationFit.indiaFriendly && (
            <span className="mt-1 inline-block rounded-md bg-zinc-50 px-1.5 py-0.5 text-sm text-zinc-700 ring-1 ring-zinc-200">India-friendly</span>
          )}
          {closed && (
            <p className="mt-2 inline-block rounded-md bg-zinc-100 px-2 py-0.5 text-sm font-semibold text-zinc-700 ring-1 ring-zinc-200">
              Closed since your search
            </p>
          )}
        </div>
      </div>

      <div className="mt-4">
        <ScoreBars breakdown={breakdown} />
      </div>

      {(reasons.length > 0 || gaps.length > 0) && (
        <ul className="mt-4 space-y-1 text-sm">
          {reasons.map((r, i) => (
            <li key={i} className="flex gap-2">
              <span className={closed ? "text-zinc-500" : "text-emerald-600"} aria-hidden>
                ✓
              </span>
              <span>
                <span className="sr-only">Why you match: </span>
                {r}
              </span>
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
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {!closed && (
          <a
            href={job.url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2"
          >
            Apply at {job.company}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        )}
        {onToggleCompare && !closed && (
          <label className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-zinc-700 ring-1 ring-zinc-200 transition-colors hover:bg-zinc-50 has-[:checked]:ring-indigo-600 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
            <input
              type="checkbox"
              checked={selected}
              disabled={compareDisabled && !selected}
              onChange={onToggleCompare}
              className="h-4 w-4 rounded accent-indigo-600"
            />
            Compare
          </label>
        )}
        {actions}
      </div>
    </li>
  );
}
