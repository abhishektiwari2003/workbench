import type { MatchResult } from "@/lib/types";

function usd(n: number): string {
  return n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(3)}`;
}

/** The result hero: counts by tier, the funnel in one line, honest cost, board health, and how we read the resume. */
export default function ResultSummary({ result }: { result: MatchResult }) {
  const { matches, stats, cost, profile, funnel } = result;
  const strong = matches.filter((m) => m.tier === "strong").length;
  const good = matches.filter((m) => m.tier === "good").length;
  const failed = stats.boards.filter((b) => !b.ok);

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
      <h2 className="text-2xl font-semibold">
        {strong + good > 0 ? (
          <>
            <span className="text-indigo-600">{strong}</span> strong · <span className="text-indigo-600">{good}</span> good{" "}
            {strong + good === 1 ? "match" : "matches"}
          </>
        ) : (
          "No strong or good matches yet"
        )}
      </h2>
      <p className="mt-1 text-sm text-zinc-500">
        {funnel.scanned.toLocaleString()} roles scanned · {funnel.prefiltered} pre-filtered · {funnel.scored} scored · {funnel.explained}{" "}
        explained · {(stats.ms / 1000).toFixed(1)}s
        {result.feedbackCount ? ` · ranked with your ${result.feedbackCount} ${result.feedbackCount === 1 ? "rating" : "ratings"}` : ""}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-md bg-zinc-50 px-2 py-0.5 ring-1 ring-zinc-200">
          Cost to compute <span className="font-semibold tabular-nums">{usd(cost.computeUsd)}</span>
        </span>
        {result.servedFromCache ? (
          <span className="rounded-md bg-indigo-50 px-2 py-0.5 font-semibold text-indigo-700 ring-1 ring-indigo-600/20">
            Served from cache · $0 spent
          </span>
        ) : (
          <span className="text-zinc-500">
            {Object.entries(cost.byStage)
              .map(([stage, v]) => `${stage} ${usd(v ?? 0)}`)
              .join(" · ")}
          </span>
        )}
      </div>

      {failed.length > 0 && (
        <ul className="mt-4 space-y-1 text-sm text-amber-700" aria-label="Job boards with problems">
          {failed.map((b) => (
            <li key={b.company}>
              {b.company} couldn&apos;t be reached:{" "}
              {b.stale ? `showing its last known ${b.count} jobs.` : "its jobs are missing from this search."}
            </li>
          ))}
        </ul>
      )}
      {stats.unscored > 0 && (
        <p className="mt-2 text-sm text-amber-700">
          {stats.unscored} shortlisted roles couldn&apos;t be scored this time. Run the search again to include them.
        </p>
      )}
      {(stats.unexplained ?? 0) > 0 && (
        <p className="mt-2 text-sm text-amber-700">
          Explanations are unavailable for {stats.unexplained} {stats.unexplained === 1 ? "role" : "roles"}, so their first-pass scores are shown. Run the
          search again to get them.
        </p>
      )}

      <div className="mt-4 border-t border-zinc-200 pt-4 text-sm">
        <p className="text-zinc-500">How we read your resume</p>
        <p className="mt-1">
          {profile.headline}{" "}
          <span className="text-zinc-500">
            · {profile.yearsExperience} yrs{profile.country ? ` · ${profile.country}` : ""}
          </span>
        </p>
        <p className="mt-1 text-zinc-500">Targeting: {profile.targetTitles.join(", ")}</p>
        <ul className="mt-2 flex flex-wrap gap-1" aria-label="Skills we matched on">
          {profile.skills.map((s) => (
            <li key={s} className="rounded-md bg-zinc-50 px-2 py-0.5 text-zinc-500 ring-1 ring-zinc-200">
              {s}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
