import type { Dictionary } from "@/lib/i18n/config";

interface DbErrorLike {
  message?: string;
  code?: string;
  details?: string | null;
}

/** Converts a PostgREST / PostgreSQL error into a translated, user-safe message. */
export function dbErrorMessage(error: unknown, t: Dictionary): string {
  const e = (error ?? {}) as DbErrorLike;
  const msg = e.message ?? "";
  const zg = /ZG_[A-Z_]+/.exec(msg)?.[0] as keyof Dictionary["errors"] | undefined;
  if (zg && zg in t.errors) return t.errors[zg];
  if (e.code === "23505") return t.errors.unique;
  if (e.code === "42501" || /row-level security|permission denied/i.test(msg)) return t.common.forbidden;
  if (e.code === "23514" || e.code === "22P02" || e.code === "23502") return t.errors.validation;
  if (e.code === "PGRST116") return t.common.notFound;
  return t.common.errorGeneric;
}

/** Structured server-side error log (shows up in Vercel / server logs). */
export function logError(scope: string, error: unknown, extra: Record<string, unknown> = {}) {
  const e = error as DbErrorLike & { stack?: string };
  console.error(
    JSON.stringify({
      level: "error",
      scope,
      message: e?.message ?? String(error),
      code: e?.code,
      details: e?.details,
      ...extra,
      at: new Date().toISOString(),
    }),
  );
}
