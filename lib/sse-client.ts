// Browser side of the match stream. EventSource can't POST, so we read SSE frames from a fetch body.
import { humanMessage } from "./client-api";
import type { PipelineEvent } from "./types";

export type StreamOutcome = { ok: true } | { ok: false; status: number; message: string };

/** Streams pipeline events to `onEvent`. Throws only AbortError (a newer submit superseded this one). */
export async function streamMatch(resumeText: string, signal: AbortSignal, onEvent: (e: PipelineEvent) => void): Promise<StreamOutcome> {
  let res: Response;
  try {
    res = await fetch("/api/match/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resumeText }),
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    return { ok: false, status: 0, message: "We couldn't reach the server. Check your connection and retry." };
  }
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => null);
    return { ok: false, status: res.status, message: humanMessage(res.status, body) };
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += value;
      let end: number;
      while ((end = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = frame
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trimStart())
          .join("\n");
        if (data) onEvent(JSON.parse(data) as PipelineEvent);
      }
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    return { ok: false, status: 0, message: "The connection dropped before your matches arrived. Please retry." };
  }
  return { ok: true };
}
