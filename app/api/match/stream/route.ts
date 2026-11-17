// POST /api/match/stream  { resumeText } -> text/event-stream of PipelineEvent (board, stage, cost, result | error)
// Same front door and pipeline as POST /api/match; progress streams live for the funnel UI.
import { prepareMatch } from "@/lib/match-request";
import { runMatch } from "@/lib/pipeline/run";
import { sseResponse } from "@/lib/sse";
import { recordRun } from "@/lib/users";

export const maxDuration = 60; // the pipeline has its own 45s deadline

export async function POST(req: Request) {
  const p = await prepareMatch(req);
  if (p.error) return p.error;
  return sseResponse(async (send) => {
    const result = await runMatch(p.resumeText, { ...p.opts, emit: send });
    recordRun(p.userId, result);
  });
}
