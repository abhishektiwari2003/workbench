// POST /api/copilot/simulate  { resultId, addSkills[], addTitles[] } -> how many more jobs would qualify.
// Free: re-runs only the deterministic prefilter against the current job snapshot.
import { fail, handleError, ok, parseBody } from "@/lib/api";
import { getJobs } from "@/lib/boards";
import { clientKey, LIMITS, limitOr429 } from "@/lib/rate-limit";
import { simulate, SimulateRequestSchema } from "@/lib/simulate";
import { getContext, getResult } from "@/lib/store";

export async function POST(req: Request) {
  const limited = limitOr429(clientKey(req, "simulate"), LIMITS.simulate);
  if (limited) return limited;
  const { data, error } = await parseBody(req, SimulateRequestSchema);
  if (error) return error;

  const ctx = getContext(data.resultId);
  const result = getResult(data.resultId);
  if (!ctx || !result) return fail(404, "not_found", "These matches have expired. Run a new search.");
  try {
    const snapshot = await getJobs();
    return ok({ ...simulate(ctx, result, snapshot.jobs, data), costUsd: 0 });
  } catch (err) {
    return handleError(err);
  }
}
