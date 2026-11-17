import { NEAR_SCORE, STRONG_SCORE, type MatchResult } from "@/lib/schemas";
import JobCard from "./JobCard";

type Props = { result: MatchResult; closedIds: Set<string>; restored: boolean; onRerun: () => void };

function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

export default function Results({ result, closedIds, restored, onRerun }: Props) {
  const { matches, nearMisses, stats, cost, profile } = result;
  const failed = stats.boards.filter((b) => !b.ok);
  const closedCount = [...matches, ...nearMisses].filter((m) => closedIds.has(m.job.id)).length;
  const unscored = stats.unscored ?? 0;

  return (
    <div className="fade-in space-y-4">
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

      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-semibold">
          <span className="text-indigo-600">{matches.length}</span> strong {matches.length === 1 ? "match" : "matches"}
        </h2>
        <p className="mt-1 text-sm text-zinc-500">
          From {stats.jobsScanned.toLocaleString()} open roles at {stats.boards.length} companies · {stats.analysed} closest
          reviewed by AI · {(stats.ms / 1000).toFixed(1)}s · AI cost ${cost.usd.toFixed(3)}
        </p>
        <div className="mt-4 border-t border-zinc-200 pt-4 text-sm">
          <p className="text-zinc-500">How we read your resume</p>
          <p className="mt-1">{profile.headline}</p>
          <ul className="mt-2 flex flex-wrap gap-1" aria-label="Skills we matched on">
            {profile.skills.map((s) => (
              <li key={s} className="rounded-md bg-zinc-50 px-2 py-0.5 text-zinc-500 ring-1 ring-zinc-200">
                {s}
              </li>
            ))}
          </ul>
        </div>
        {failed.length > 0 && (
          <p className="mt-4 text-sm text-amber-700">
            Couldn&apos;t reach {failed.map((b) => b.company).join(", ")} just now
            {failed.some((b) => b.stale) ? "; using their last known jobs." : "; their jobs are missing from this search."}
          </p>
        )}
        {unscored > 0 && (
          <p className="mt-4 text-sm text-amber-700">
            {unscored} of the closest roles couldn&apos;t be reviewed by AI this time. Run the search again to include them.
          </p>
        )}
      </section>

      {matches.length > 0 ? (
        <ul className="space-y-4" aria-label="Strong matches">
          {matches.map((m) => (
            <JobCard key={m.job.id} match={m} closed={closedIds.has(m.job.id)} />
          ))}
        </ul>
      ) : (
        <section className="rounded-2xl border border-zinc-200 bg-zinc-50 p-6 text-sm">
          <p className="font-semibold">No strong matches right now.</p>
          <p className="mt-1 text-zinc-500">
            We only show roles that scored {STRONG_SCORE} or higher. Make sure your resume lists the roles and skills you want next, or
            check back after the next job refresh.
          </p>
        </section>
      )}

      {nearMisses.length > 0 && (
        <details className="group rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <summary className="cursor-pointer rounded-lg text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600">
            {nearMisses.length} near {nearMisses.length === 1 ? "miss" : "misses"} (score {NEAR_SCORE}-{STRONG_SCORE - 1}) worth a look
          </summary>
          <ul className="mt-4 space-y-4">
            {nearMisses.map((m) => (
              <JobCard key={m.job.id} match={m} closed={closedIds.has(m.job.id)} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
