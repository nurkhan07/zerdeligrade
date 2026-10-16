"use server";
import { z } from "zod";
import { ActionFailure, failOnDbError, runAction, type ActionResult } from "@/lib/actions";
import { can } from "@/lib/auth/permissions";
import { fmt } from "@/lib/i18n/config";
import { logError } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteStoredFile } from "@/server/files";

const answersSchema = z.record(z.string().regex(/^\d{1,3}$/), z.enum(["A", "B", "C", "D", "E"]).nullable());

/** Saves the teacher's review. The score is recomputed by public.review_result in the database. */
export async function reviewResultAction(
  resultId: string,
  answers: Record<string, "A" | "B" | "C" | "D" | "E" | null>,
  studentId: string | null,
  comment: string,
): Promise<ActionResult<{ score: number; percentage: number }>> {
  return runAction("results.review", "results", async ({ t, supabase }) => {
    const id = z.string().uuid().safeParse(resultId);
    const a = answersSchema.safeParse(answers);
    const s = z.string().uuid().nullable().safeParse(studentId);
    if (!id.success || !a.success || !s.success) throw new ActionFailure(t.errors.validation);
    const { data, error } = await supabase.rpc("review_result", {
      p_result: id.data,
      p_answers: a.data,
      p_student: s.data,
      p_comment: comment.slice(0, 1000),
    });
    if (error) failOnDbError(error, t, "results.review");
    const d = data as { score: number; percentage: number };
    return { ok: true, message: t.results.reviewSaved, data: { score: Number(d.score), percentage: Number(d.percentage) } };
  });
}

export async function finalizeResultAction(resultId: string, comment = ""): Promise<ActionResult> {
  return runAction("results.finalize", "results", async ({ app, t, supabase }) => {
    if (!can.finalizeResults(app)) throw new ActionFailure(t.common.forbidden);
    if (!z.string().uuid().safeParse(resultId).success) throw new ActionFailure(t.common.notFound);
    const { error } = await supabase.rpc("finalize_result", { p_result: resultId, p_comment: comment.slice(0, 1000) });
    if (error) failOnDbError(error, t, "results.finalize");
    return { ok: true, message: t.results.finalized };
  });
}

/** Finalizes several results; only those without open warnings succeed (enforced in SQL). */
export async function finalizeManyAction(resultIds: string[]): Promise<ActionResult<{ count: number }>> {
  return runAction("results.finalize_many", "results", async ({ app, t, supabase }) => {
    if (!can.finalizeResults(app)) throw new ActionFailure(t.common.forbidden);
    const ids = z.array(z.string().uuid()).max(200).safeParse(resultIds);
    if (!ids.success) throw new ActionFailure(t.errors.validation);
    let count = 0;
    for (const id of ids.data) {
      const { error } = await supabase.rpc("finalize_result", { p_result: id, p_comment: "" });
      if (!error) count++;
    }
    return { ok: true, message: fmt(t.results.batchFinalized, { count }), data: { count } };
  });
}

export async function reopenResultAction(resultId: string, reason: string): Promise<ActionResult> {
  return runAction("results.reopen", "results", async ({ app, t, supabase }) => {
    if (!can.reopenResults(app)) throw new ActionFailure(t.common.forbidden);
    if (!z.string().uuid().safeParse(resultId).success) throw new ActionFailure(t.common.notFound);
    if (reason.trim().length < 3) throw new ActionFailure(t.errors.ZG_COMMENT_REQUIRED);
    const { error } = await supabase.rpc("reopen_result", { p_result: resultId, p_comment: reason.slice(0, 1000) });
    if (error) failOnDbError(error, t, "results.reopen");
    return { ok: true, message: t.results.reopened };
  });
}

export async function createManualResultAction(
  testId: string,
  studentId: string,
  answers: Record<string, "A" | "B" | "C" | "D" | "E" | null>,
): Promise<ActionResult<{ id: string }>> {
  return runAction("results.manual", "scan", async ({ t, supabase }) => {
    const ok = z.string().uuid().safeParse(testId).success && z.string().uuid().safeParse(studentId).success;
    const a = answersSchema.safeParse(answers);
    if (!ok || !a.success) throw new ActionFailure(t.errors.validation);
    const { data, error } = await supabase.rpc("create_manual_result", { p_test: testId, p_student: studentId, p_answers: a.data });
    if (error) failOnDbError(error, t, "results.manual");
    return { ok: true, message: t.common.saved, data: { id: data as string } };
  });
}

/**
 * Voids (annuls) a result. Permissions, the reason requirement and the
 * finalized-only-by-admin rule are enforced by public.void_result. The photo
 * is then removed right away; if that fails the retention job removes it.
 */
export async function voidResultAction(resultId: string, reason: string): Promise<ActionResult> {
  return runAction("results.void", "results", async ({ t, supabase }) => {
    if (!z.string().uuid().safeParse(resultId).success) throw new ActionFailure(t.common.notFound);
    if (reason.trim().length < 3) throw new ActionFailure(t.errors.ZG_COMMENT_REQUIRED);
    const { data: result } = await supabase.from("assessment_results").select("scan_job_id").eq("id", resultId).maybeSingle();
    const { error } = await supabase.rpc("void_result", { p_result: resultId, p_reason: reason.slice(0, 1000) });
    if (error) failOnDbError(error, t, "results.void");

    if (result?.scan_job_id) {
      try {
        const admin = createAdminClient();
        const { data: job } = await admin.from("scan_jobs").select("file_id").eq("id", result.scan_job_id).maybeSingle();
        if (job?.file_id) {
          const { data: file } = await admin.from("file_metadata").select("id, bucket, object_path").eq("id", job.file_id).is("deleted_at", null).maybeSingle();
          if (file) await deleteStoredFile(admin, file);
        }
      } catch (e) {
        logError("results.void.photo", e, { resultId });
      }
    }
    return { ok: true, message: t.results.voided };
  });
}
