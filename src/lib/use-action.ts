"use client";
import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/action-types";
import { useI18n } from "@/lib/i18n/client";

/**
 * Calls a server action, shows a toast only for the real outcome and
 * refreshes server data on success.
 */
export function useAction() {
  const router = useRouter();
  const { t } = useI18n();
  const [running, setRunning] = useState(false);
  // Keeps `pending` true until the refreshed server data has rendered, so the
  // UI never shows stale state right after a successful action.
  const [refreshing, startRefresh] = useTransition();

  const run = useCallback(
    async <T,>(fn: () => Promise<ActionResult<T>>, opts: { success?: string; refresh?: boolean } = {}): Promise<ActionResult<T>> => {
      setRunning(true);
      try {
        const res = await fn();
        if (res.ok) {
          const msg = res.message ?? opts.success;
          if (msg) toast.success(msg);
          if (opts.refresh !== false) startRefresh(() => router.refresh());
        } else {
          toast.error(res.error);
        }
        return res;
      } catch {
        toast.error(t.common.errorGeneric);
        return { ok: false, error: t.common.errorGeneric };
      } finally {
        setRunning(false);
      }
    },
    [router, t],
  );

  return { run, pending: running || refreshing };
}

/** Translates a field error key produced by the shared zod schemas. */
export function useFieldError() {
  const { t } = useI18n();
  return (key: string | undefined) => (key ? ((t.validation as Record<string, string>)[key] ?? t.errors.validation) : undefined);
}
