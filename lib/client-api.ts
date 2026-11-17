// Browser-side fetch wrapper: one result shape and human error messages, never raw error objects.
type ApiErrorBody = { error?: { code?: string; message?: string; fields?: Record<string, string> } };

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

function humanMessage(status: number, body: ApiErrorBody | null): string {
  const err = body?.error;
  if (status === 429) return err?.message ?? "You're going a bit fast. Wait a moment and retry.";
  if (err?.code?.startsWith("llm_")) return "Our AI matcher is busy right now. Your resume is fine. Please retry.";
  if (err?.fields) return Object.values(err.fields)[0] ?? "Please check your input.";
  if (status < 500 && err?.message) return err.message;
  if (status === 503 && err?.message) return err.message;
  return "Something went wrong on our side. Please retry.";
}

/** Throws only AbortError (so callers can ignore superseded requests). */
export async function callApi<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    return { ok: false, status: 0, message: "We couldn't reach the server. Check your connection and retry." };
  }
  let body: ({ data?: T } & ApiErrorBody) | null = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (res.ok && body?.data !== undefined) return { ok: true, data: body.data };
  return { ok: false, status: res.status, message: humanMessage(res.status, body) };
}
