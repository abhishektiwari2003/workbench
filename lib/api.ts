// Shared helpers for route handlers: one success shape, one error shape,
// body validation with size limits, and LLM error mapping.
import { NextResponse } from "next/server";
import { z } from "zod";
import { LLMError, llmErrorStatus, type LLMErrorKind } from "./llm";

export type ApiError = { error: { code: string; message: string; fields?: Record<string, string> } };

/** An error that is safe to show the user, with its HTTP status and code. Mapped by handleError. */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ data }, { status });
}

export function fail(status: number, code: string, message: string, fields?: Record<string, string>) {
  return NextResponse.json<ApiError>({ error: { code, message, ...(fields ? { fields } : {}) } }, { status });
}

const MAX_BODY_BYTES = 200_000;

/**
 * Reads the body, stopping as soon as it passes `maxBytes` (checks Content-Length first, then counts
 * streamed bytes, so chunked uploads cannot bypass the cap). Throws only if the stream itself breaks.
 */
export async function readBodyCapped(req: Request, maxBytes: number): Promise<Buffer | "too_large"> {
  if (Number(req.headers.get("content-length") ?? 0) > maxBytes) return "too_large";
  if (!req.body) return Buffer.alloc(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return "too_large";
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** Parses and validates a JSON body. Returns either data or a ready-made error response. */
export async function parseBody<T>(
  req: Request,
  schema: z.ZodType<T>,
): Promise<{ data: T; error?: never } | { data?: never; error: NextResponse }> {
  let body: Buffer | "too_large";
  try {
    body = await readBodyCapped(req, MAX_BODY_BYTES);
  } catch {
    return { error: fail(400, "invalid_body", "The request body could not be read. Please retry.") };
  }
  if (body === "too_large") return { error: fail(413, "too_large", "Request is too large") };

  let json: unknown;
  try {
    json = JSON.parse(body.toString("utf8"));
  } catch {
    return { error: fail(400, "invalid_json", "Request body must be valid JSON") };
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[issue.path.join(".") || "body"] = issue.message;
    return { error: fail(400, "validation_error", "Some fields are invalid", fields) };
  }
  return { data: parsed.data };
}

// Fixed client-facing text per kind; the detailed message (schema paths, config) stays in server logs.
const LLM_MESSAGES: Record<LLMErrorKind, string> = {
  timeout: "The AI took too long to respond. Please retry.",
  rate_limit: "Our AI matcher is busy right now. Please retry shortly.",
  overloaded: "Our AI matcher is busy right now. Please retry shortly.",
  parse: "The AI returned an unexpected answer. Please retry.",
  api: "Our AI matcher is unavailable right now. Please retry.",
  config: "Our AI matcher is unavailable right now. Please retry.",
};

/** Safe status, code and message for any thrown error (also used for errors sent mid-stream over SSE). */
export function describeError(err: unknown): { status: number; code: string; message: string } {
  if (err instanceof AppError) return { status: err.status, code: err.code, message: err.message };
  if (err instanceof LLMError) {
    console.warn(JSON.stringify({ evt: "llm_error", kind: err.kind, detail: err.message }));
    return { status: llmErrorStatus(err), code: `llm_${err.kind}`, message: LLM_MESSAGES[err.kind] };
  }
  console.error(err);
  return { status: 500, code: "internal_error", message: "Something went wrong. Please try again." };
}

/** Converts any thrown error into a safe JSON response without leaking internals. */
export function handleError(err: unknown) {
  const { status, code, message } = describeError(err);
  return fail(status, code, message);
}
