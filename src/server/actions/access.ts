"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionFailure, failOnDbError, runAction, type ActionResult } from "@/lib/actions";
import { dbErrorMessage, logError } from "@/lib/errors";
import { getI18n } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";

/** Called by a signed-in user who has no membership yet (so not via runAction). */
export async function requestAccessAction(centerId: string, fullName: string, message: string): Promise<ActionResult> {
  const { t } = await getI18n();
  const ok = z.string().uuid().safeParse(centerId).success && fullName.trim().length >= 2;
  if (!ok) return { ok: false, error: t.errors.validation };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: t.common.forbidden };
  const { error } = await supabase.rpc("request_access", { p_center: centerId, p_full_name: fullName.slice(0, 200), p_message: message.slice(0, 500) });
  if (error) {
    logError("access.request", error);
    return { ok: false, error: dbErrorMessage(error, t) };
  }
  revalidatePath("/no-access");
  return { ok: true, message: t.access.sent };
}

export async function decideAccessRequestAction(requestId: string, approve: boolean, comment = ""): Promise<ActionResult> {
  return runAction("access.decide", "users", async ({ t, supabase }) => {
    if (!z.string().uuid().safeParse(requestId).success) throw new ActionFailure(t.common.notFound);
    if (!approve && comment.trim().length < 3) throw new ActionFailure(t.errors.ZG_COMMENT_REQUIRED);
    const { error } = await supabase.rpc("decide_access_request", { p_request: requestId, p_approve: approve, p_comment: comment.slice(0, 1000) });
    if (error) failOnDbError(error, t, "access.decide");
    return { ok: true, message: approve ? t.access.approved : t.access.rejectedDone };
  });
}
