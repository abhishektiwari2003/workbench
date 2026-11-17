// POST /api/copilot  { action: "coach", resultId } | { action: "tailor"|"outreach"|"prep", resultId, jobId }
//   -> { output, costUsd, cached }. Fast tier, only runs when the user clicks.
import { fail, handleError, ok, parseBody } from "@/lib/api";
import { CopilotRequestSchema, runCopilot } from "@/lib/copilot";
import { requireUser, userKey } from "@/lib/auth";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { getContext, getResult } from "@/lib/store";

export async function POST(req: Request) {
  let userId: string;
  try {
    userId = await requireUser();
  } catch (err) {
    return handleError(err);
  }
  const limited = limitOr429(userKey(userId, "copilot"), LIMITS.copilot, "Too many copilot requests.");
  if (limited) return limited;
  const { data, error } = await parseBody(req, CopilotRequestSchema);
  if (error) return error;

  const ctx = getContext(data.resultId, userId); // owner only
  const result = getResult(data.resultId, userId);
  if (!ctx || !result) return fail(404, "not_found", "These matches have expired. Run a new search.");
  try {
    return ok(await runCopilot(data, ctx, result));
  } catch (err) {
    return handleError(err);
  }
}
