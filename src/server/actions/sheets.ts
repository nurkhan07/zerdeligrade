"use server";
import { z } from "zod";
import { ActionFailure, failOnDbError, runAction, type ActionResult } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { fmt } from "@/lib/i18n/config";
import { GEOMETRY } from "@/lib/omr/layout";
import { generateSheetCode } from "@/lib/omr/sheet-code";

const schema = z.object({
  testId: z.string().uuid(),
  language: z.enum(["kk", "ru"]),
  mode: z.enum(["class", "student", "blank"]),
  classId: z.string().uuid().nullable().optional(),
  studentId: z.string().uuid().nullable().optional(),
  count: z.coerce.number().int().min(1).max(200).optional(),
  paperSize: z.enum(["a4", "a5"]).default("a4"),
});

export async function generateSheetsAction(input: z.input<typeof schema>): Promise<ActionResult<{ batchId: string; count: number }>> {
  return runAction("sheets.generate", "answerSheets", async ({ app, t, supabase }) => {
    const parsed = schema.safeParse(input);
    if (!parsed.success) throw new ActionFailure(t.errors.validation);
    const p = parsed.data;

    const { data: test } = await supabase.from("tests").select("id, center_id, status, question_count").eq("id", p.testId).maybeSingle();
    if (!test || !test.center_id) throw new ActionFailure(t.common.notFound);
    if (test.status !== "published") throw new ActionFailure(t.sheets.onlyPublished);
    if (p.paperSize === "a5" && test.question_count > GEOMETRY.a5.maxQuestions) throw new ActionFailure(t.sheets.a5TooMany);

    type Target = { student_id: string | null; class_id: string | null; student_label: string };
    let targets: Target[] = [];
    if (p.mode === "class") {
      if (!p.classId) throw new ActionFailure(t.errors.validation);
      const { data: students, error } = await supabase
        .from("students")
        .select("id, first_name, last_name, class_id")
        .eq("class_id", p.classId)
        .eq("center_id", test.center_id)
        .eq("status", "active")
        .order("last_name")
        .limit(200);
      if (error) failOnDbError(error, t, "sheets.students");
      if (!students?.length) throw new ActionFailure(t.sheets.noStudents);
      targets = students.map((s) => ({ student_id: s.id, class_id: s.class_id, student_label: `${s.last_name} ${s.first_name}` }));
    } else if (p.mode === "student") {
      if (!p.studentId) throw new ActionFailure(t.errors.validation);
      const { data: s } = await supabase
        .from("students")
        .select("id, first_name, last_name, class_id, center_id")
        .eq("id", p.studentId)
        .maybeSingle();
      if (!s || s.center_id !== test.center_id) throw new ActionFailure(t.common.notFound);
      targets = [{ student_id: s.id, class_id: s.class_id, student_label: `${s.last_name} ${s.first_name}` }];
    } else {
      targets = Array.from({ length: p.count ?? 1 }, () => ({ student_id: null, class_id: p.classId ?? null, student_label: "" }));
    }

    const batchId = crypto.randomUUID();
    const rows = targets.map((tg) => ({
      ...tg,
      center_id: test.center_id,
      test_id: test.id,
      sheet_code: generateSheetCode(),
      batch_id: batchId,
      language: p.language,
      paper_size: p.paperSize,
      question_count: test.question_count,
      created_by: app.userId,
    }));
    const { error } = await supabase.from("answer_sheets").insert(rows);
    if (error) failOnDbError(error, t, "sheets.insert");
    await audit({
      actorId: app.userId,
      centerId: test.center_id,
      action: "sheets.generated",
      entityType: "answer_sheet_batch",
      entityId: batchId,
      details: { test_id: test.id, count: rows.length, mode: p.mode },
    });
    return { ok: true, message: fmt(t.sheets.generated, { count: rows.length }), data: { batchId, count: rows.length } };
  });
}
