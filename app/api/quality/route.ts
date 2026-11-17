// POST /api/quality { resultId } -> agreement, precision of the top 5, false-negative rate, cost, per-job verdicts.
// The smart tier judges 5 matches and the 5 most borderline rejected jobs, without seeing our scores.
import { z } from "zod";
import { fail, handleError, ok, parseBody } from "@/lib/api";
import { requireUser, userKey } from "@/lib/auth";
import { judgeQuality } from "@/lib/quality";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { getContext, getResult } from "@/lib/store";

const QualityRequest = z.object({ resultId: z.uuid() });

export async function POST(req: Request) {
  try {
    const userId = await requireUser();
    const limited = limitOr429(userKey(userId, "quality"), LIMITS.quality, "Too many quality checks.");
    if (limited) return limited;
    const { data, error } = await parseBody(req, QualityRequest);
    if (error) return error;
    const ctx = getContext(data.resultId, userId);
    const result = getResult(data.resultId, userId);
    if (!ctx || !result) return fail(404, "not_found", "These matches have expired. Run a new search.");
    return ok(await judgeQuality(ctx, result));
  } catch (err) {
    return handleError(err);
  }
}
