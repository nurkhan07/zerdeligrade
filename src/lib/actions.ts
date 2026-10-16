import "server-only";
import { AuthError, requireActionContext, type AppContext } from "@/lib/auth/context";
import type { NavKey } from "@/lib/auth/permissions";
import { dbErrorMessage, logError } from "@/lib/errors";
import { getI18n } from "@/lib/i18n/server";
import type { Dictionary, Locale } from "@/lib/i18n/config";
import { createClient, type ServerSupabase } from "@/lib/supabase/server";

import type { ActionResult } from "@/lib/action-types";
export type { ActionResult };

export interface ActionEnv {
  app: AppContext;
  t: Dictionary;
  locale: Locale;
  supabase: ServerSupabase;
}

export class ActionFailure extends Error {
  constructor(
    public readonly userMessage: string,
    public readonly fieldErrors?: Record<string, string>,
  ) {
    super(userMessage);
  }
}

/**
 * Wraps a server action: authenticates the caller, provides a user-scoped
 * Supabase client and translations, and converts every failure into a safe,
 * translated message (details go to the server log only).
 */
export async function runAction<T>(
  scope: string,
  nav: NavKey | undefined,
  fn: (env: ActionEnv) => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  const { t, locale } = await getI18n();
  try {
    const app = await requireActionContext(nav);
    const supabase = await createClient();
    return await fn({ app, t, locale, supabase });
  } catch (error) {
    if (error instanceof ActionFailure) return { ok: false, error: error.userMessage, fieldErrors: error.fieldErrors };
    if (error instanceof AuthError) return { ok: false, error: t.common.forbidden };
    logError(scope, error);
    return { ok: false, error: dbErrorMessage(error, t) };
  }
}

/** Throws a translated failure for a database error. */
export function failOnDbError(error: unknown, t: Dictionary, scope: string): never {
  logError(scope, error);
  throw new ActionFailure(dbErrorMessage(error, t));
}

export function requireActiveCenter(env: ActionEnv): string {
  if (!env.app.activeCenterId) throw new ActionFailure(env.t.centerSwitch.required);
  return env.app.activeCenterId;
}
