"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { callApi } from "@/lib/client-api";
import { funnelReducer, initialFunnel } from "@/lib/funnel-state";
import { readSavedId, readSavedResume, remember } from "@/lib/saved-run";
import { SAMPLE_RESUME } from "@/lib/sample-resume";
import { RESUME_MAX, RESUME_MIN } from "@/lib/schemas";
import { streamMatch } from "@/lib/sse-client";
import type { MatchResult, PipelineEvent } from "@/lib/types";
import History from "./dashboard/History";
import { useMe } from "./dashboard/useMe";
import Funnel from "./pipeline/Funnel";
import ResumeInput from "./ResumeInput";
import Results from "./Results";
import ResultsSkeleton from "./ResultsSkeleton";

type Saved = MatchResult & { closedJobIds?: string[] };
type ErrorState = { message: string; retry: () => void };

export default function MatchApp() {
  const [resume, setResume] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ErrorState | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [result, setResult] = useState<MatchResult | null>(null);
  const [closedIds, setClosedIds] = useState<Set<string>>(new Set());
  const [restored, setRestored] = useState(false);
  const [funnel, dispatch] = useReducer(funnelReducer, undefined, initialFunnel);
  const [showFunnel, setShowFunnel] = useState(false);
  const [announce, setAnnounce] = useState("");
  const { me, reload, setMe } = useMe();
  const controller = useRef<AbortController | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  async function restore(id: string) {
    setError(null);
    const r = await callApi<Saved>(`/api/matches/${encodeURIComponent(id)}`);
    if (controller.current) return; // the user already started a new search: never overwrite it
    if (!r.ok) {
      // Only a gone or invalid link is forgotten; a network blip or 429 keeps it for a retry.
      if ((r.status === 404 || r.status === 400) && readSavedId() === id) remember(null);
      else if (r.status !== 404 && r.status !== 400)
        setError({ message: "We couldn't load your saved matches just now.", retry: () => restore(id) });
      return;
    }
    setResult(r.data);
    setClosedIds(new Set(r.data.closedJobIds ?? []));
    setRestored(true);
    setShowFunnel(false);
    const text = readSavedResume(id);
    if (text) setResume((current) => current || text);
  }

  async function submit(override?: string) {
    const text = (override ?? resume).trim();
    if (text.length < RESUME_MIN) return setFieldError(`Add a bit more: at least ${RESUME_MIN} characters of resume text.`);
    if (text.length > RESUME_MAX) return setFieldError(`That's too long: keep it under ${RESUME_MAX.toLocaleString()} characters.`);
    setFieldError(null);
    setError(null);

    controller.current?.abort(); // a newer submit supersedes any request still in flight
    const ctrl = new AbortController();
    controller.current = ctrl;
    setPending(true);
    setShowFunnel(true);
    dispatch({ type: "reset" });
    setAnnounce("Finding your matches.");
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" }));

    let streamError: string | null = null;
    const onEvent = (e: PipelineEvent) => {
      if (controller.current !== ctrl) return; // superseded
      dispatch(e);
      if (e.type === "result") {
        setResult(e.result);
        setClosedIds(new Set());
        setRestored(false);
        remember(e.result.id, text);
        const n = e.result.matches.filter((m) => m.tier !== "closest").length;
        setAnnounce(n ? `Found ${n} ${n === 1 ? "match" : "matches"}.` : "No strong or good matches; showing the closest roles.");
      } else if (e.type === "error") streamError = e.message;
    };
    try {
      const outcome = await streamMatch(text, ctrl.signal, onEvent);
      const message = streamError ?? (outcome.ok ? null : outcome.message);
      if (message) {
        setError({ message, retry: () => submit(text) }); // announced once, by the alert itself
        setAnnounce("");
      }
      reload(); // history and quota
    } catch {
      return; // aborted by a newer submit
    } finally {
      if (controller.current === ctrl) setPending(false);
    }
  }

  useEffect(() => {
    callApi("/api/jobs"); // warms the server's job snapshot so the first search starts faster
    const params = new URLSearchParams(window.location.search);
    if (params.get("sample") === "1") {
      // From the landing page's "Try with sample resume": fill it in and run it once.
      history.replaceState(null, "", window.location.pathname);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time init from the ?sample=1 link
      setResume(SAMPLE_RESUME);
      submit(SAMPLE_RESUME);
    } else {
      const id = readSavedId();
      if (id) restore(id);
    }
    const onHash = () => {
      const id = readSavedId();
      if (id) restore(id);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once on mount
  }, []);

  async function vote(jobId: string, v: 1 | -1 | 0) {
    if (!result || !me) return;
    const votes = { ...me.votes };
    if (v === 0) delete votes[jobId];
    else votes[jobId] = v;
    setMe({ ...me, votes }); // optimistic; the next search uses it
    const r = await callApi("/api/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ resultId: result.id, jobId, vote: v }) });
    if (!r.ok) reload();
  }

  /** Reopens a past run from history (cancels any search in flight first). */
  function openRun(id: string) {
    controller.current?.abort();
    controller.current = null;
    setPending(false);
    window.location.hash = `m=${id}`; // the hashchange listener restores it
  }

  function rerun() {
    if (resume.trim()) return submit();
    // Opened from a link on another device: we don't have the resume here. Keep the saved matches visible.
    setFieldError("Paste or upload your resume to check for new jobs. Your saved matches stay below.");
    document.getElementById("resume-text")?.focus();
  }

  return (
    <div className="space-y-8">
      <History me={me} currentId={result?.id ?? null} onOpen={openRun} />
      <ResumeInput value={resume} onChange={setResume} onSubmit={() => submit()} pending={pending} fieldError={fieldError} />

      <div aria-live="polite" className="sr-only">
        {announce}
      </div>

      {error && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-rose-600/20 bg-rose-50 px-6 py-4 text-sm text-rose-700">
          <span>{error.message}</span>
          <button
            type="button"
            onClick={error.retry}
            disabled={pending}
            className="rounded-lg font-semibold underline-offset-2 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 disabled:opacity-60"
          >
            Retry
          </button>
        </div>
      )}

      <div ref={resultsRef} className="scroll-mt-4 space-y-6" aria-busy={pending}>
        {showFunnel && <Funnel state={funnel} />}
        {/* While a new search runs, the skeleton replaces the old result so stale links can't be clicked. */}
        {pending && <ResultsSkeleton />}
        {result && !pending && (
          <Results result={result} closedIds={closedIds} restored={restored} onRerun={rerun} votes={me?.votes ?? {}} onVote={vote} />
        )}
      </div>
    </div>
  );
}
