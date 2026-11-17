// Runs LLM work in parallel batches. One failed batch doesn't sink the run; all failing does.
import { AppError } from "../api";
import { LLMError } from "../llm";

type BatchOptions<T> = {
  onDone?: (batch: T[]) => void; // progress, e.g. for the live funnel
  concurrency?: number; // max batches in flight (default: all), e.g. to keep background work polite
};

export async function runBatches<T, R>(
  items: T[],
  size: number,
  fn: (batch: T[]) => Promise<R>,
  { onDone, concurrency = Infinity }: BatchOptions<T> = {},
): Promise<{ results: R[]; failed: number }> {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  const settled: PromiseSettledResult<R>[] = new Array(batches.length);
  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const i = next++;
      try {
        const r = await fn(batches[i]);
        onDone?.(batches[i]);
        settled[i] = { status: "fulfilled", value: r };
      } catch (reason) {
        settled[i] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker));
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
