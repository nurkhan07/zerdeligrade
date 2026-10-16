import "server-only";
import { buildSheetDrawing, type Primitive } from "@/lib/omr/drawing";
import { buildLayout, isSheetFormat, type SheetFormat } from "@/lib/omr/layout";
import { dictionaries, type Locale } from "@/lib/i18n/config";
import type { ServerSupabase } from "@/lib/supabase/server";

/** Option count per question position, as configured in the (published) test. */
export async function getOptionCounts(supabase: ServerSupabase, testId: string): Promise<number[] | null> {
  const { data, error } = await supabase
    .from("test_questions")
    .select("position, question_type, answer_options(label)")
    .eq("test_id", testId)
    .order("position");
  if (error || !data?.length) return null;
  return (data as unknown as Array<{ question_type: string; answer_options: Array<{ label: string }> }>).map((q) =>
    q.question_type === "true_false" ? 2 : Math.max(2, Math.min(5, q.answer_options.length)),
  );
}

export interface SheetBatch {
  title: string;
  testId: string;
  format: SheetFormat;
  pages: Primitive[][];
}

/**
 * Builds the printable drawings for a batch of sheets. Reads through the
 * user's RLS-scoped client, so a user only ever renders sheets they can see.
 */
export async function buildSheetBatch(supabase: ServerSupabase, batchId: string): Promise<SheetBatch | null> {
  const { data: sheets } = await supabase
    .from("answer_sheets")
    .select("id, sheet_code, language, paper_size, test_id, student_label, students(first_name, last_name, student_code), classes(name), centers(name)")
    .eq("batch_id", batchId)
    .order("student_label")
    .limit(500);
  type S = {
    sheet_code: string;
    language: Locale;
    paper_size: string;
    test_id: string;
    student_label: string;
    students: { first_name: string; last_name: string; student_code: string | null } | null;
    classes: { name: string } | null;
    centers: { name: string } | null;
  };
  const rows = (sheets ?? []) as unknown as S[];
  const first = rows[0];
  if (!first) return null;

  const [{ data: test }, counts] = await Promise.all([
    supabase.from("tests").select("title, subjects(name_kk, name_ru)").eq("id", first.test_id).maybeSingle(),
    getOptionCounts(supabase, first.test_id),
  ]);
  if (!test || !counts) return null;
  const tt = test as unknown as { title: string; subjects: { name_kk: string; name_ru: string } | null };
  const format: SheetFormat = isSheetFormat(first.paper_size) ? first.paper_size : "a4";
  const layout = buildLayout(counts, format);
  const hasTrueFalse = counts.includes(2);

  const pages = rows.map((s) => {
    const labels = dictionaries[s.language].sheetPrint;
    return buildSheetDrawing({
      layout,
      sheetCode: s.sheet_code,
      labels: { ...labels, instructions: [...labels.instructions] },
      testTitle: tt.title,
      subjectName: tt.subjects ? (s.language === "kk" ? tt.subjects.name_kk : tt.subjects.name_ru) : undefined,
      centerName: s.centers?.name,
      studentName: s.students ? `${s.students.last_name} ${s.students.first_name}` : s.student_label || undefined,
      studentCode: s.students?.student_code ?? undefined,
      className: s.classes?.name,
      hasTrueFalse,
    });
  });
  return { title: tt.title, testId: first.test_id, format, pages };
}
