// GET /api/matches/:id -> saved MatchResult + ids of matched jobs that have since closed
import { fail, handleError, ok } from "@/lib/api";
import { getJobs, peekJobs } from "@/lib/boards";
import { clientKey, LIMITS, limitOr429 } from "@/lib/rate-limit";
import { getResult } from "@/lib/store";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request, ctx: RouteContext<"/api/matches/[id]">) {
  const limited = limitOr429(clientKey(req, "matches-get"), LIMITS.matchesGet);
  if (limited) return limited;

  try {
    const { id } = await ctx.params;
    if (!UUID.test(id)) return fail(400, "invalid_id", "That match link isn't valid.");
    const result = getResult(id);
    if (!result) return fail(404, "not_found", "These matches have expired. Run a new search.");

    // Current snapshot (cheap inside its TTL, single-flight on a cold start); fall back to whatever is in memory.
    const snapshot = await getJobs().catch(() => peekJobs());
    const closedJobIds = snapshot
      ? result.matches.map((m) => m.job.id).filter((jobId) => !snapshot.byId.has(jobId))
      : [];
    const res = ok({ ...result, closedJobIds, closedChecked: Boolean(snapshot) });
    res.headers.set("cache-control", "private, no-store"); // resume-derived data: never in shared caches
    return res;
  } catch (err) {
    return handleError(err);
  }
}
