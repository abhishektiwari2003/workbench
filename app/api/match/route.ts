// POST /api/match  { resumeText } -> MatchResult
import { fail, handleError, ok, parseBody } from "@/lib/api";
import { runMatch } from "@/lib/pipeline/run";
import { clientKey, LIMITS, limitOr429, rateLimit } from "@/lib/rate-limit";
import { MatchRequestSchema } from "@/lib/schemas";

// The pipeline has its own 45s deadline; this keeps the platform from cutting it off first.
export const maxDuration = 60;

export async function POST(req: Request) {
  // Expensive (5 LLM calls, ~$0.06): tight per-IP limit, plus a per-instance ceiling that holds even if IPs are spoofed.
  const limited = limitOr429(clientKey(req, "match"), LIMITS.match, "You've run several searches in a row.");
  if (limited) return limited;
  if (!rateLimit("match:global", LIMITS.matchGlobal).allowed) {
    return fail(503, "busy", "We're handling a lot of searches right now. Please try again in a minute.");
  }

  const { data, error } = await parseBody(req, MatchRequestSchema);
  if (error) return error;

  try {
    return ok(await runMatch(data.resumeText));
  } catch (err) {
    return handleError(err);
  }
}
