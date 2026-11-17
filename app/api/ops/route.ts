// GET /api/ops -> board health, cache hit rates, LLM calls/tokens/cost per stage, cost today,
// average cost per candidate, quality, and the monthly cost projection. Operators only (lib/auth.ts requireOps).
import { handleError, ok } from "@/lib/api";
import { requireOps, userKey } from "@/lib/auth";
import { peekJobs } from "@/lib/boards";
import { digestCount } from "@/lib/digests";
import { metricsSnapshot } from "@/lib/metrics";
import { projection } from "@/lib/projection";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";

export async function GET() {
  try {
    const userId = await requireOps();
    const limited = limitOr429(userKey(userId, "ops"), LIMITS.ops);
    if (limited) return limited;
    const m = metricsSnapshot();
    const snapshot = peekJobs();
    const jobsTotal = snapshot?.jobs.length ?? 0;
    const digestedJobs = digestCount();
    const res = ok({
      ...m,
      runs: m.runs.slice(-10),
      jobs: { total: jobsTotal, fetchedAt: snapshot ? new Date(snapshot.fetchedAt).toISOString() : null, boards: snapshot?.boards ?? [] },
      digests: { cached: digestedJobs, coverage: jobsTotal ? digestedJobs / jobsTotal : 0 },
      projection: projection({ runs: m.runs, digestUsd: m.llm["job-digest"]?.usd ?? 0, digestedJobs, jobsTotal: jobsTotal || 3_300 }),
    });
    res.headers.set("cache-control", "private, no-store");
    return res;
  } catch (err) {
    return handleError(err);
  }
}
