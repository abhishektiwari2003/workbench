// POST /api/match  { resumeText } -> MatchResult (JSON). Signed-in only; same pipeline as /api/match/stream.
import { handleError, ok } from "@/lib/api";
import { prepareMatch } from "@/lib/match-request";
import { runMatch } from "@/lib/pipeline/run";
import { recordRun } from "@/lib/users";

// The pipeline has its own 45s deadline; this keeps the platform from cutting it off first.
export const maxDuration = 60;

export async function POST(req: Request) {
  const p = await prepareMatch(req);
  if (p.error) return p.error;
  try {
    const result = await runMatch(p.resumeText, p.opts);
    recordRun(p.userId, result);
    return ok(result);
  } catch (err) {
    return handleError(err);
  }
}
