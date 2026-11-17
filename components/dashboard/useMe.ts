"use client";

import { useCallback, useEffect, useState } from "react";
import { callApi } from "@/lib/client-api";
import type { RunSummary } from "@/lib/users";

export type Me = {
  runs: RunSummary[];
  quota: { used: number; limit: number; remaining: number };
  newJobsSinceLastVisit: number | null;
  previousVisitAt: string | null;
  votes: Record<string, 1 | -1>;
};

/** The signed-in user's history, quota, visit info and votes. `reload` after a run or a vote. */
export function useMe() {
  const [me, setMe] = useState<Me | null>(null);
  const reload = useCallback(async () => {
    const r = await callApi<Me>("/api/me");
    if (r.ok) setMe(r.data);
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
    reload();
  }, [reload]);
  return { me, reload, setMe };
}
