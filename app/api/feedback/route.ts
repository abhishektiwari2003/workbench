// POST /api/feedback { resultId, jobId, vote: 1 | -1 | 0 } -> { ratings }
// Thumbs up/down on a match; nudges this user's future rankings (lib/feedback.ts). 0 clears the vote.
import { z } from "zod";
import { fail, handleError, ok, parseBody } from "@/lib/api";
import { requireUser, userKey } from "@/lib/auth";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { getResult } from "@/lib/store";
import { setVote, votesOf } from "@/lib/users";

const FeedbackSchema = z.object({
  resultId: z.uuid(),
  jobId: z.string().max(120),
  vote: z.union([z.literal(1), z.literal(-1), z.literal(0)]),
});

export async function POST(req: Request) {
  try {
    const userId = await requireUser();
    const limited = limitOr429(userKey(userId, "feedback"), LIMITS.feedback);
    if (limited) return limited;
    const { data, error } = await parseBody(req, FeedbackSchema);
    if (error) return error;
    const match = getResult(data.resultId, userId)?.matches.find((m) => m.job.id === data.jobId);
    if (!match) return fail(404, "not_found", "That match isn't in your results.");
    setVote(userId, data.jobId, data.vote, { company: match.job.company, title: match.job.title });
    return ok({ ratings: votesOf(userId).size });
  } catch (err) {
    return handleError(err);
  }
}
