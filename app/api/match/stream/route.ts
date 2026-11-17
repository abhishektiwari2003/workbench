// POST /api/match/stream  { resumeText } -> text/event-stream of PipelineEvent (board, stage, cost, result | error)
// Same front door and pipeline as POST /api/match; progress streams live for the funnel UI.
import { executeMatch, prepareMatch } from "@/lib/match-request";
import { sseResponse } from "@/lib/sse";

export const maxDuration = 60; // the pipeline has its own 45s deadline

export async function POST(req: Request) {
  const p = await prepareMatch(req);
  if (p.error) return p.error;
  return sseResponse((send) => executeMatch(p, send));
}
