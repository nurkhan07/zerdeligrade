"use server";
import { ActionFailure, failOnDbError, runAction, type ActionResult } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { can } from "@/lib/auth/permissions";
import { fmt } from "@/lib/i18n/config";
import { isUuid } from "@/lib/utils";
import { fieldErrors, LABELS, questionsSchema, testMetaSchema, type QuestionInput, type TestMetaInput } from "@/lib/validation/schemas";

function defaultQuestions(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    position: i + 1,
    type: "single_choice",
    prompt: "",
    points: 1,
    correct: null,
    options: LABELS.slice(0, 5).map((label) => ({ label, text: "" })),
  }));
}

export async function createTestAction(input: TestMetaInput): Promise<ActionResult<{ id: string }>> {
  return runAction("tests.create", "tests", async ({ app, t, supabase }) => {
    const parsed = testMetaSchema.safeParse(input);
    if (!parsed.success) throw new ActionFailure(t.errors.validation, fieldErrors(parsed.error));
    const { id: _ignored, hq_template, is_template, ...meta } = parsed.data;
    void _ignored;
    // HQ working in "all centers" mode can only create network-wide templates.
    const asHq = (hq_template || !app.activeCenterId) && can.manageHqTemplates(app);
    const centerId = asHq ? null : app.activeCenterId;
    if (!asHq && !centerId) throw new ActionFailure(t.centerSwitch.required);

    const { data: row, error } = await supabase
      .from("tests")
      .insert({ ...meta, center_id: centerId, is_template: asHq || is_template, created_by: app.userId, status: "draft" })
      .select("id")
      .single();
    if (error) failOnDbError(error, t, "tests.create");

    const { error: qErr } = await supabase.rpc("save_test_content", {
      p_test: row.id,
      p_questions: defaultQuestions(meta.question_count),
    });
    if (qErr) failOnDbError(qErr, t, "tests.create.questions");
    await audit({ actorId: app.userId, centerId, action: "test.created", entityType: "test", entityId: row.id, details: { title: meta.title } });
    return { ok: true, message: t.common.created, data: { id: row.id } };
  });
}

export async function updateTestMetaAction(id: string, input: TestMetaInput): Promise<ActionResult> {
  return runAction("tests.update", "tests", async ({ app, t, supabase }) => {
    if (!isUuid(id)) throw new ActionFailure(t.common.notFound);
    const parsed = testMetaSchema.safeParse(input);
    if (!parsed.success) throw new ActionFailure(t.errors.validation, fieldErrors(parsed.error));
    const { data: current } = await supabase.from("tests").select("status, center_id").eq("id", id).maybeSingle();
    if (!current) throw new ActionFailure(t.common.notFound);
    if (current.status !== "draft") throw new ActionFailure(t.errors.ZG_TEST_LOCKED);
    // question_count is owned by the questions editor; template flags are fixed at creation.
    const { id: _i, question_count: _q, hq_template: _h, is_template: _t, ...meta } = parsed.data;
    void _i; void _q; void _h; void _t;
    const { data: row, error } = await supabase.from("tests").update(meta).eq("id", id).select("id").maybeSingle();
    if (error) failOnDbError(error, t, "tests.update");
    if (!row) throw new ActionFailure(t.common.forbidden);
    await audit({ actorId: app.userId, centerId: current.center_id, action: "test.updated", entityType: "test", entityId: id });
    return { ok: true, message: t.common.saved };
  });
}

export async function saveQuestionsAction(id: string, questions: QuestionInput[]): Promise<ActionResult> {
  return runAction("tests.questions", "tests", async ({ t, supabase }) => {
    if (!isUuid(id)) throw new ActionFailure(t.common.notFound);
    const parsed = questionsSchema.safeParse(questions);
    if (!parsed.success) throw new ActionFailure(t.errors.ZG_INVALID_QUESTIONS);
    const payload = parsed.data.map((q, i) => {
      const count = q.type === "true_false" ? 2 : q.option_count;
      const labels = LABELS.slice(0, count);
      if (q.correct && !labels.includes(q.correct)) throw new ActionFailure(fmt(t.tests.quickKeyInvalid, { position: i + 1 }));
      return {
        position: i + 1,
        type: q.type,
        prompt: q.prompt,
        points: q.points,
        correct: q.correct,
        options: labels.map((label, k) => ({ label, text: q.options[k] ?? "" })),
      };
    });
    const { error } = await supabase.rpc("save_test_content", { p_test: id, p_questions: payload });
    if (error) failOnDbError(error, t, "tests.questions");
    return { ok: true, message: t.tests.questionsSaved };
  });
}

export async function publishTestAction(id: string): Promise<ActionResult> {
  return runAction("tests.publish", "tests", async ({ t, supabase }) => {
    if (!isUuid(id)) throw new ActionFailure(t.common.notFound);
    const { error } = await supabase.rpc("publish_test", { p_test: id });
    if (error) failOnDbError(error, t, "tests.publish");
    return { ok: true, message: t.tests.published };
  });
}

export async function setTestArchivedAction(id: string, archived: boolean): Promise<ActionResult> {
  return runAction("tests.archive", "tests", async ({ app, t, supabase }) => {
    if (!isUuid(id)) throw new ActionFailure(t.common.notFound);
    const { data: row, error } = await supabase
      .from("tests")
      .update({ status: archived ? "archived" : "published" })
      .eq("id", id)
      .in("status", archived ? ["published"] : ["archived"])
      .select("center_id")
      .maybeSingle();
    if (error) failOnDbError(error, t, "tests.archive");
    if (!row) throw new ActionFailure(t.errors.ZG_INVALID_STATUS);
    await audit({ actorId: app.userId, centerId: row.center_id, action: archived ? "test.archived" : "test.updated", entityType: "test", entityId: id });
    return { ok: true, message: t.common.saved };
  });
}

export async function duplicateTestAction(
  id: string,
  opts: { asTemplate?: boolean; hq?: boolean; title?: string } = {},
): Promise<ActionResult<{ id: string }>> {
  return runAction("tests.duplicate", "tests", async ({ app, t, supabase }) => {
    if (!isUuid(id)) throw new ActionFailure(t.common.notFound);
    const toHq = Boolean(opts.hq) && can.manageHqTemplates(app);
    const centerId = toHq ? null : app.activeCenterId;
    if (!toHq && !centerId) throw new ActionFailure(t.centerSwitch.required);
    const { data, error } = await supabase.rpc("duplicate_test", {
      p_test: id,
      p_center: centerId,
      p_as_template: toHq || Boolean(opts.asTemplate),
      p_title: opts.title?.slice(0, 200) ?? null,
    });
    if (error) failOnDbError(error, t, "tests.duplicate");
    return { ok: true, message: t.tests.duplicated, data: { id: data as string } };
  });
}

export async function deleteTestAction(id: string): Promise<ActionResult> {
  return runAction("tests.delete", "tests", async ({ app, t, supabase }) => {
    if (!isUuid(id)) throw new ActionFailure(t.common.notFound);
    const { data: row, error } = await supabase.from("tests").delete().eq("id", id).eq("status", "draft").select("center_id, title").maybeSingle();
    if (error) failOnDbError(error, t, "tests.delete");
    if (!row) throw new ActionFailure(t.tests.deleteDraftOnly);
    await audit({ actorId: app.userId, centerId: row.center_id, action: "test.deleted", entityType: "test", entityId: id, details: { title: row.title } });
    return { ok: true, message: t.common.deleted };
  });
}

export async function assignTestAction(testId: string, classId: string): Promise<ActionResult> {
  return runAction("tests.assign", "tests", async ({ app, t, supabase }) => {
    if (!isUuid(testId) || !isUuid(classId)) throw new ActionFailure(t.common.notFound);
    const { data: test } = await supabase.from("tests").select("center_id").eq("id", testId).maybeSingle();
    if (!test?.center_id) throw new ActionFailure(t.common.forbidden);
    const { error } = await supabase
      .from("test_assignments")
      .insert({ test_id: testId, class_id: classId, center_id: test.center_id, assigned_by: app.userId });
    if (error && error.code !== "23505") failOnDbError(error, t, "tests.assign");
    await audit({ actorId: app.userId, centerId: test.center_id, action: "test.updated", entityType: "test", entityId: testId, details: { assigned_class: classId } });
    return { ok: true, message: t.tests.assigned };
  });
}

export async function unassignTestAction(testId: string, classId: string): Promise<ActionResult> {
  return runAction("tests.unassign", "tests", async ({ app, t, supabase }) => {
    if (!isUuid(testId) || !isUuid(classId)) throw new ActionFailure(t.common.notFound);
    const { data: row, error } = await supabase
      .from("test_assignments")
      .delete()
      .eq("test_id", testId)
      .eq("class_id", classId)
      .select("center_id")
      .maybeSingle();
    if (error) failOnDbError(error, t, "tests.unassign");
    if (!row) throw new ActionFailure(t.common.forbidden);
    await audit({ actorId: app.userId, centerId: row.center_id, action: "test.updated", entityType: "test", entityId: testId, details: { unassigned_class: classId } });
    return { ok: true, message: t.common.saved };
  });
}
