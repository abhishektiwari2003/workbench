// POST /api/match  { resumeText } -> MatchResult (JSON). Signed-in only; same pipeline as /api/match/stream.
import { handleError, ok } from "@/lib/api";
import { executeMatch, prepareMatch } from "@/lib/match-request";

// The pipeline has its own 45s deadline; this keeps the platform from cutting it off first.
export const maxDuration = 60;

export async function POST(req: Request) {
  const p = await prepareMatch(req);
  if (p.error) return p.error;
  try {
    return ok(await executeMatch(p));
  } catch (err) {
    return handleError(err);
  }
}
