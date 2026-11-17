// Shared helpers for route handlers: one success shape, one error shape,
// body validation with size limits, and LLM error mapping.
import { NextResponse } from "next/server";
import { z } from "zod";
import { LLMError, llmErrorStatus } from "./llm";

export type ApiError = { error: { code: string; message: string; fields?: Record<string, string> } };

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ data }, { status });
}

export function fail(status: number, code: string, message: string, fields?: Record<string, string>) {
  return NextResponse.json<ApiError>({ error: { code, message, ...(fields ? { fields } : {}) } }, { status });
}

const MAX_BODY_BYTES = 200_000;

/** Parses and validates a JSON body. Returns either data or a ready-made error response. */
export async function parseBody<T>(
  req: Request,
  schema: z.ZodType<T>,
): Promise<{ data: T; error?: never } | { data?: never; error: NextResponse }> {
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return { error: fail(413, "too_large", "Request is too large") };

  let json: unknown;
  try {
    json = JSON.parse(raw);
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

/** Converts any thrown error into a safe JSON response without leaking internals. */
export function handleError(err: unknown) {
  if (err instanceof LLMError) return fail(llmErrorStatus(err), `llm_${err.kind}`, err.message);
  console.error(err);
  return fail(500, "internal_error", "Something went wrong. Please try again.");
}
