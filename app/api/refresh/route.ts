// POST /api/refresh[?simulate=N] -> RefreshReport
// Called by the scheduler (Bearer CRON_SECRET; see lib/refresh.ts for the cron setup). In local dev a
// signed-in user may also trigger it from /ops, and ?simulate=N (dev only) treats N plausible jobs as new.
// Fails closed in production when CRON_SECRET is not configured.
import { createHash, timingSafeEqual } from "node:crypto";
import { fail, handleError, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { LIMITS, limitOr429 } from "@/lib/rate-limit";
import { runRefresh } from "@/lib/refresh";

export const maxDuration = 120;

function sameToken(given: string, expected: string): boolean {
  // Hash first so lengths match; timingSafeEqual avoids leaking the secret through response timing.
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  try {
    const secret = process.env.CRON_SECRET;
    const isProd = process.env.NODE_ENV === "production";
    const viaScheduler = Boolean(secret) && sameToken(req.headers.get("authorization") ?? "", `Bearer ${secret}`);
    if (!viaScheduler) {
      if (isProd) return fail(secret ? 401 : 503, secret ? "unauthorized" : "not_configured", "Refresh is only available to the scheduler.");
      await requireUser(); // local dev: any signed-in user (the /ops button)
    }
    const limited = limitOr429("refresh:global", LIMITS.jobsRefresh, "A refresh just ran.");
    if (limited) return limited;

    const n = Number(new URL(req.url).searchParams.get("simulate") ?? 0);
    const simulate = !isProd && Number.isInteger(n) && n > 0 ? Math.min(n, 10) : 0;
    return ok(await runRefresh({ simulate }));
  } catch (err) {
    return handleError(err);
  }
}
