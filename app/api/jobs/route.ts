// GET /api/jobs -> board stats (and warms the job cache so the first match is faster)
import { handleError, ok } from "@/lib/api";
import { getJobs } from "@/lib/boards";
import { clientKey, LIMITS, limitOr429 } from "@/lib/rate-limit";

export async function GET(req: Request) {
  const limited = limitOr429(clientKey(req, "jobs"), LIMITS.jobs);
  if (limited) return limited;
  try {
    const s = await getJobs();
    return ok({ total: s.jobs.length, boards: s.boards, fetchedAt: new Date(s.fetchedAt).toISOString() });
  } catch (err) {
    return handleError(err);
  }
}
