// Server-Sent Events from a route handler: one `data:` frame per pipeline event, a heartbeat to keep
// proxies from closing the connection, and errors delivered as a final event in the safe error shape.
import { describeError } from "./api";
import type { PipelineEvent } from "./types";

const HEARTBEAT_MS = 10_000;

export function sseResponse(run: (send: (e: PipelineEvent) => void) => Promise<unknown>): Response {
  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true; // the client went away; the shared run keeps going and fills the cache
        }
      };
      const send = (e: PipelineEvent) => write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
      write(": connected\n\n"); // flush headers immediately so the browser starts reading
      const heartbeat = setInterval(() => write(": ping\n\n"), HEARTBEAT_MS);
      try {
        await run(send);
      } catch (err) {
        const { code, message } = describeError(err);
        send({ type: "error", code, message });
      } finally {
        clearInterval(heartbeat);
        if (!closed) controller.close();
        closed = true;
      }
    },
    cancel() {
      closed = true;
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform", // no-transform stops compression from buffering the stream
      "x-accel-buffering": "no",
      connection: "keep-alive",
    },
  });
}
