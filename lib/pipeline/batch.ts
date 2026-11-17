// Runs LLM work in parallel batches. One failed batch doesn't sink the run; all failing does.
import { AppError } from "../api";
import { LLMError } from "../llm";

export async function runBatches<T, R>(
  items: T[],
  size: number,
  fn: (batch: T[]) => Promise<R>,
  onDone?: (batch: T[]) => void,
): Promise<{ results: R[]; failed: number }> {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  const settled = await Promise.allSettled(
    batches.map(async (b) => {
      const r = await fn(b);
      onDone?.(b);
      return r;
    }),
  );
  const failures = settled.filter((s): s is PromiseRejectedResult => s.status === "rejected");
  for (const f of failures) {
    console.warn(JSON.stringify({ evt: "batch_failed", error: f.reason instanceof Error ? f.reason.message : String(f.reason) }));
  }
  if (batches.length > 0 && failures.length === batches.length) {
    const reason = failures[0].reason;
    if (reason instanceof AppError || reason instanceof LLMError) throw reason;
    throw new LLMError("All batches failed", "api");
  }
  const results = settled.filter((s): s is PromiseFulfilledResult<Awaited<R>> => s.status === "fulfilled").map((s) => s.value);
  return { results, failed: failures.length };
}
