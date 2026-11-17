"use client";

import { useMemo, useState } from "react";
import { applyFilters, companiesIn, DEFAULT_FILTERS, type Filters } from "@/lib/filters";
import { GOOD_SCORE, STRONG_SCORE } from "@/lib/schemas";
import type { MatchResult, ScoredJob, Tier } from "@/lib/types";
import CoachPanel from "./copilot/CoachPanel";
import JobActions from "./copilot/JobActions";
import QualityPanel from "./copilot/QualityPanel";
import FeedbackButtons from "./dashboard/FeedbackButtons";
import JobCard from "./JobCard";
import { COMPARE_MAX, CompareBar, CompareDialog } from "./results/Compare";
import FiltersBar from "./results/FiltersBar";
import ResultSummary from "./ResultSummary";

type Props = {
  result: MatchResult;
  closedIds: Set<string>;
  restored: boolean;
  onRerun: () => void;
  votes: Record<string, 1 | -1>;
  onVote: (jobId: string, v: 1 | -1 | 0) => void;
};

function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

const SECTIONS: { tier: Tier; title: string; note: string }[] = [
  { tier: "strong", title: "Strong matches", note: `Scored ${STRONG_SCORE}+: likely to pass a recruiter screen.` },
  { tier: "good", title: "Good matches", note: `Scored ${GOOD_SCORE}-${STRONG_SCORE - 1}: worth applying, with a gap to address.` },
  { tier: "closest", title: "Closest available", note: `Nothing scored ${GOOD_SCORE}+ right now. These are the nearest roles, with honest gaps.` },
];

export default function Results({ result, closedIds, restored, onRerun, votes, onVote }: Props) {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [selected, setSelected] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);
  const visible = useMemo(() => applyFilters(result.matches, filters), [result.matches, filters]);
  const companies = useMemo(() => companiesIn(result.matches), [result.matches]);
  const closedCount = result.matches.filter((m) => closedIds.has(m.job.id)).length;
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length < COMPARE_MAX ? [...s, id] : s));

  const card = (m: ScoredJob) => (
    <JobCard
      key={m.job.id}
      match={m}
      closed={closedIds.has(m.job.id)}
      selected={selected.includes(m.job.id)}
      compareDisabled={selected.length >= COMPARE_MAX}
      onToggleCompare={() => toggle(m.job.id)}
      actions={
        closedIds.has(m.job.id) ? undefined : (
          <>
            <JobActions resultId={result.id} jobId={m.job.id} />
            <FeedbackButtons vote={votes[m.job.id]} onVote={(v) => onVote(m.job.id, v)} />
          </>
        )
      }
    />
  );

  return (
    <div className={`fade-in space-y-6 ${selected.length ? "pb-20" : ""}`}>
      {restored && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-zinc-200 bg-zinc-50 px-6 py-3 text-sm">
          <span>
            Your saved matches from {timeAgo(result.createdAt)}
            {closedCount > 0 ? `. ${closedCount} ${closedCount === 1 ? "role has" : "roles have"} closed since.` : "."}
          </span>
          <button
            type="button"
            onClick={onRerun}
            className="rounded-lg font-semibold text-indigo-600 transition-colors hover:text-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
          >
            Check for new jobs
          </button>
        </div>
      )}

      <ResultSummary result={result} />

      {result.matches.length > 0 && <CoachPanel key={result.id} resultId={result.id} shownIds={new Set(result.matches.map((m) => m.job.id))} />}
      {result.matches.length > 0 && <QualityPanel key={`q-${result.id}`} resultId={result.id} />}

      {result.matches.length === 0 ? (
        <section className="rounded-2xl border border-zinc-200 bg-zinc-50 p-6 text-sm">
          <p className="font-semibold">No roles on these boards line up with this resume.</p>
          <p className="mt-1 text-zinc-500">
            None of the {result.stats.jobsScanned.toLocaleString()} open roles shares a title or core skills with it. Check that your
            resume names the roles and skills you want next.
          </p>
        </section>
      ) : (
        <FiltersBar filters={filters} onChange={setFilters} companies={companies} shown={visible.length} total={result.matches.length} />
      )}

      {result.matches.length > 0 && visible.length === 0 && (
        <p className="rounded-2xl border border-zinc-200 bg-zinc-50 p-6 text-sm text-zinc-500">
          No matches with these filters. Clear a filter to see the rest.
        </p>
      )}

      {filters.sort === "newest" ? (
        visible.length > 0 && <ul className="space-y-4" aria-label="Matches, newest first">{visible.map(card)}</ul>
      ) : (
        SECTIONS.map(({ tier, title, note }) => {
          const jobs = visible.filter((m) => m.tier === tier);
          if (jobs.length === 0) return null;
          return (
            <section key={tier} aria-labelledby={`tier-${tier}`}>
              <div className="mb-3 flex items-baseline justify-between gap-2">
                <h2 id={`tier-${tier}`} className="text-base font-semibold">
                  {title} <span className="text-zinc-500">({jobs.length})</span>
                </h2>
                <p className="hidden text-sm text-zinc-500 sm:block">{note}</p>
              </div>
              <ul className="space-y-4">{jobs.map(card)}</ul>
            </section>
          );
        })
      )}

      <CompareBar count={selected.length} onOpen={() => setComparing(true)} onClear={() => setSelected([])} />
      <CompareDialog
        jobs={result.matches.filter((m) => selected.includes(m.job.id))}
        open={comparing && selected.length >= 2}
        onClose={() => setComparing(false)}
      />
    </div>
  );
}
