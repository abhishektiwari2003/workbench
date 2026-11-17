// GET /api/me -> { runs, quota, newJobsSinceLastVisit, previousVisitAt, votes }
// "New since your last visit" counts postings published after the previous visit started.
import { handleError, ok } from "@/lib/api";
import { requireUser, userKey } from "@/lib/auth";
import { getJobs } from "@/lib/boards";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { history, quotaOf, touchVisit, votesOf } from "@/lib/users";

export async function GET() {
  try {
    const userId = await requireUser();
    const limited = limitOr429(userKey(userId, "me"), LIMITS.matchesGet);
    if (limited) return limited;
    const previousVisitAt = touchVisit(userId);
    const snapshot = await getJobs().catch(() => null);
    const newJobsSinceLastVisit =
      previousVisitAt && snapshot ? snapshot.jobs.filter((j) => j.postedAt && Date.parse(j.postedAt) > previousVisitAt).length : null;
    const res = ok({
      runs: history(userId),
      quota: quotaOf(userId),
      newJobsSinceLastVisit,
      previousVisitAt: previousVisitAt ? new Date(previousVisitAt).toISOString() : null,
      votes: Object.fromEntries([...votesOf(userId)].map(([id, v]) => [id, v.vote])),
    });
    res.headers.set("cache-control", "private, no-store");
    return res;
  } catch (err) {
    return handleError(err);
  }
}
