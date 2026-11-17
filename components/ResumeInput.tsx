"use client";

import { useRef, useState } from "react";
import { callApi } from "@/lib/client-api";
import { MAX_FILE_BYTES, RESUME_MAX, RESUME_MIN } from "@/lib/schemas";
import { SAMPLE_RESUME } from "@/lib/sample-resume";

type Props = {
  value: string;
  onChange: (text: string) => void;
  onSubmit: () => void;
  pending: boolean;
  fieldError: string | null;
};

export default function ResumeInput({ value, onChange, onSubmit, pending, fieldError }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [fileNote, setFileNote] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const length = value.trim().length;
  const over = length > RESUME_MAX;

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setFileError(null);
    setFileNote(null);
    if (file.size > MAX_FILE_BYTES) return setFileError("Files must be 5 MB or smaller.");
    setUploading(true);
    const form = new FormData();
    form.append("file", file);
    const res = await callApi<{ text: string; truncated: boolean }>("/api/resume", { method: "POST", body: form });
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
    if (!res.ok) return setFileError(res.message);
    onChange(res.data.text);
    setFileNote(`Loaded ${file.name}${res.data.truncated ? " (trimmed to the first ${RESUME_MAX.toLocaleString()} characters)" : ""}. Check the text below, then find your matches.`);
  }

  const error = fileError ?? fieldError;

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          id="resume-file"
          type="file"
          accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
          className="sr-only"
          onChange={(e) => handleFile(e.target.files?.[0])}
          disabled={uploading || pending}
        />
        <label
          htmlFor="resume-file"
          className="cursor-pointer rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold transition-colors hover:bg-zinc-50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-indigo-600"
        >
          {uploading ? "Reading file..." : "Upload resume (PDF or TXT)"}
        </label>
        <button
          type="button"
          onClick={() => {
            onChange(SAMPLE_RESUME);
            setFileNote("Loaded a sample resume.");
            setFileError(null);
          }}
          className="rounded-lg px-3 py-2 text-sm text-zinc-500 transition-colors hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
        >
          Try an example
        </button>
      </div>

      <label htmlFor="resume-text" className="mt-6 block text-sm font-semibold">
        Resume text
      </label>
      <p id="resume-help" className="text-sm text-zinc-500">
        Upload a file or paste your resume. Any language works.
      </p>
      <textarea
        id="resume-text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onSubmit();
          }
        }}
        rows={10}
        aria-describedby="resume-help resume-count resume-error"
        aria-invalid={Boolean(error) || over}
        placeholder="Paste your resume here..."
        className="mt-2 w-full resize-y rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm leading-relaxed focus-visible:border-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
      />
      <div className="mt-1 flex justify-between gap-4 text-sm">
        {/* Always-present live region: upload progress, success and validation errors are all announced. */}
        <p id="resume-error" className={error ? "text-rose-600" : "text-zinc-500"} aria-live="polite">
          {uploading ? "Reading your file..." : (error ?? fileNote ?? "")}
        </p>
        <p id="resume-count" className={`shrink-0 tabular-nums ${over ? "text-rose-600" : "text-zinc-500"}`}>
          {length.toLocaleString()} / {RESUME_MAX.toLocaleString()}
        </p>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={onSubmit}
          disabled={pending || uploading}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />}
          {pending ? "Finding matches..." : "Find my matches"}
        </button>
        <span className="hidden text-sm text-zinc-500 sm:inline">
          {length > 0 && length < RESUME_MIN ? `At least ${RESUME_MIN} characters` : "⌘/Ctrl + Enter"}
        </span>
      </div>
    </section>
  );
}
