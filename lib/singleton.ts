// In-memory state that survives dev-server module reloads (Turbopack re-evaluates modules on recompiles,
// which would otherwise wipe users' history mid-demo). In production each process keeps one copy anyway;
// at scale these maps move to Redis/Postgres (docs/SCALE.md section 7).
const root = globalThis as typeof globalThis & { __cocareer?: Record<string, unknown> };

export function singleton<T>(key: string, init: () => T): T {
  root.__cocareer ??= {};
  if (!(key in root.__cocareer)) root.__cocareer[key] = init();
  return root.__cocareer[key] as T;
}
