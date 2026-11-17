"use client";

import { useEffect, useRef, useState } from "react";
import { callApi } from "@/lib/client-api";
import { RESUME_MAX, RESUME_MIN } from "@/lib/schemas";
import type { MatchResult } from "@/lib/types";
import ResumeInput from "./ResumeInput";
import Results from "./Results";
import ResultsSkeleton from "./ResultsSkeleton";

const STORAGE_KEY = "cocareer:lastMatch";
const RESUME_KEY = "cocareer:lastResume"; // { id, text }: kept on this device only, so "Check for new jobs" can re-run

type Saved = MatchResult & { closedJobIds?: string[] };
type ErrorState = { message: string; retry: () => void };

function readSavedId(): string | null {
  const fromHash = new URLSearchParams(window.location.hash.slice(1)).get("m");
  if (fromHash) return fromHash;
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function readSavedResume(id: string): string | null {
  try {
    const saved = JSON.parse(localStorage.getItem(RESUME_KEY) ?? "null") as { id?: string; text?: string } | null;
    return saved?.id === id && typeof saved.text === "string" ? saved.text : null;
  } catch {
    return null;
  }
}

function remember(id: string | null, resumeText?: string) {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
    if (id && resumeText) localStorage.setItem(RESUME_KEY, JSON.stringify({ id, text: resumeText }));
    else if (!id) localStorage.removeItem(RESUME_KEY);
  } catch {
    // storage blocked (private mode): the URL hash still works
  }
  history.replaceState(null, "", id ? `#m=${id}` : window.location.pathname);
}

export default function MatchApp() {
  const [resume, setResume] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ErrorState | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [result, setResult] = useState<MatchResult | null>(null);
  const [closedIds, setClosedIds] = useState<Set<string>>(new Set());
  const [restored, setRestored] = useState(false);
  const [jobsTotal, setJobsTotal] = useState<number | null>(null);
  const [announce, setAnnounce] = useState("");
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
    const text = readSavedResume(id);
    if (text) setResume((current) => current || text);
  }

  useEffect(() => {
    // Warm the server's job cache and show the live count; restore saved matches if any.
    callApi<{ total: number }>("/api/jobs").then((r) => r.ok && setJobsTotal(r.data.total));
    const id = readSavedId();
    if (id) restore(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once on mount
  }, []);

  async function submit() {
    const text = resume.trim();
    if (text.length < RESUME_MIN) return setFieldError(`Add a bit more: at least ${RESUME_MIN} characters of resume text.`);
    if (text.length > RESUME_MAX) return setFieldError(`That's too long: keep it under ${RESUME_MAX.toLocaleString()} characters.`);
    setFieldError(null);
    setError(null);

    controller.current?.abort(); // a newer submit supersedes any request still in flight
    const ctrl = new AbortController();
    controller.current = ctrl;
    setPending(true);
    setAnnounce("Finding your matches.");
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" }));
    try {
      const res = await callApi<MatchResult>("/api/match", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resumeText: text }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        setError({ message: res.message, retry: submit }); // announced once, by the alert itself
        setAnnounce("");
        return;
      }
      setResult(res.data);
      setClosedIds(new Set());
      setRestored(false);
      remember(res.data.id, text);
      const n = res.data.matches.filter((m) => m.tier !== "closest").length;
      setAnnounce(n ? `Found ${n} ${n === 1 ? "match" : "matches"}.` : "No strong or good matches; showing the closest roles.");
    } catch {
      return; // aborted by a newer submit
    } finally {
      if (controller.current === ctrl) setPending(false);
    }
  }

  function rerun() {
    if (resume.trim()) return submit();
    // Opened from a link on another device: we don't have the resume here. Keep the saved matches visible.
    setFieldError("Paste or upload your resume to check for new jobs. Your saved matches stay below.");
    document.getElementById("resume-text")?.focus();
  }

  return (
    <div className="space-y-8">
      <ResumeInput value={resume} onChange={setResume} onSubmit={submit} pending={pending} fieldError={fieldError} />

      <div aria-live="polite" className="sr-only">
        {announce}
      </div>

      {error && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-rose-600/20 bg-rose-50 px-6 py-4 text-sm text-rose-600">
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

      <div ref={resultsRef} className="scroll-mt-4" aria-busy={pending}>
        {/* While a new search runs, the skeleton replaces the old result so stale links can't be clicked. */}
        {pending && <ResultsSkeleton jobsTotal={jobsTotal} />}
        {result && !pending && <Results result={result} closedIds={closedIds} restored={restored} onRerun={rerun} />}
      </div>
    </div>
  );
}
