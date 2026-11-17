// POST /api/match/stream  { resumeText } -> text/event-stream of PipelineEvent (board, stage, cost, result | error)
// Same pipeline, limits and validation as POST /api/match; progress streams live for the funnel UI.
import { fail, parseBody } from "@/lib/api";
import { runMatch } from "@/lib/pipeline/run";
import { clientKey, LIMITS, limitOr429, rateLimit } from "@/lib/rate-limit";
import { MatchRequestSchema } from "@/lib/schemas";
import { sseResponse } from "@/lib/sse";

export const maxDuration = 60; // the pipeline has its own 45s deadline

export async function POST(req: Request) {
  const limited = limitOr429(clientKey(req, "match"), LIMITS.match, "You've run several searches in a row.");
  if (limited) return limited;
  if (!rateLimit("match:global", LIMITS.matchGlobal).allowed) {
    return fail(503, "busy", "We're handling a lot of searches right now. Please try again in a minute.");
  }
  const { data, error } = await parseBody(req, MatchRequestSchema);
  if (error) return error;

  return sseResponse((send) => runMatch(data.resumeText, { emit: send }));
}
