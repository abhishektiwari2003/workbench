"use client";

import { useState } from "react";
import { callApi } from "@/lib/client-api";
import { CostChip, Spinner } from "./CostChip";

type Action = "tailor" | "outreach" | "prep";
type Tailor = { bullets: { before: string; after: string }[] };
type Outreach = { subject: string; message: string };
type Prep = { questions: { question: string; why: string }[] };
type Out = { output: Tailor | Outreach | Prep; costUsd: number; cached: boolean };

const LABELS: Record<Action, string> = { tailor: "Tailor my resume", outreach: "Write outreach", prep: "Prep me" };

function asText(action: Action, output: Out["output"]): string {
  if (action === "outreach") return `${(output as Outreach).subject}\n\n${(output as Outreach).message}`;
  if (action === "tailor") return (output as Tailor).bullets.map((b) => `• ${b.after}`).join("\n");
  return (output as Prep).questions.map((q, i) => `${i + 1}. ${q.question}`).join("\n");
}

/** Per-job copilot buttons. Each runs only when clicked; the answer and its cost show inline. */
export default function JobActions({ resultId, jobId }: { resultId: string; jobId: string }) {
  const [open, setOpen] = useState<Action | null>(null);
  const [outputs, setOutputs] = useState<Partial<Record<Action, Out>>>({});
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function run(action: Action) {
    if (open === action) return setOpen(null);
    setOpen(action);
    setError(null);
    if (outputs[action]) return; // already fetched: free to reopen
    setBusy(action);
    const r = await callApi<Out>("/api/copilot", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, resultId, jobId }) });
    setBusy(null);
    if (!r.ok) return setError(r.message);
    setOutputs((o) => ({ ...o, [action]: r.data }));
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Copy failed; select the text instead.");
    }
  }

  const out = open ? outputs[open] : undefined;
  return (
    <>
      {(Object.keys(LABELS) as Action[]).map((a) => (
        <button
          key={a}
          type="button"
          aria-expanded={open === a}
          onClick={() => run(a)}
          disabled={busy !== null && busy !== a}
          className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm ring-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 disabled:opacity-60 ${open === a ? "bg-zinc-900 text-white ring-zinc-900" : "text-zinc-700 ring-zinc-200 hover:bg-zinc-50"}`}
        >
          {busy === a && <Spinner light={open === a} />}
          {LABELS[a]}
        </button>
      ))}
      {open && (
        <div className="fade-in basis-full rounded-lg bg-zinc-50 p-4 text-sm" aria-live="polite">
          {busy === open && (
            <div className="space-y-2" aria-hidden>
              <div className="h-4 w-11/12 animate-pulse rounded bg-zinc-200" />
              <div className="h-4 w-4/5 animate-pulse rounded bg-zinc-200" />
              <div className="h-4 w-3/4 animate-pulse rounded bg-zinc-200" />
            </div>
          )}
          {error && <p role="alert" className="text-rose-700">{error}</p>}
          {out && open === "tailor" && (
            <ol className="space-y-3">
              {(out.output as Tailor).bullets.map((b, i) => (
                <li key={i}>
                  <p className="text-zinc-500">Before: {b.before}</p>
                  <p className="mt-0.5">After: {b.after}</p>
                </li>
              ))}
            </ol>
          )}
          {out && open === "outreach" && (
            <div>
              <p className="font-semibold">{(out.output as Outreach).subject}</p>
              <p className="mt-1 whitespace-pre-wrap">{(out.output as Outreach).message}</p>
            </div>
          )}
          {out && open === "prep" && (
            <ol className="list-decimal space-y-2 pl-5">
              {(out.output as Prep).questions.map((q, i) => (
                <li key={i}>
                  <p>{q.question}</p>
                  <p className="text-zinc-500">{q.why}</p>
                </li>
              ))}
            </ol>
          )}
          {out && (
            <div className="mt-3 flex items-center gap-3">
              <CostChip usd={out.costUsd} cached={out.cached} />
              <button
                type="button"
                onClick={() => copy(asText(open, out.output))}
                className="rounded text-sm font-semibold text-indigo-600 transition-colors hover:text-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
