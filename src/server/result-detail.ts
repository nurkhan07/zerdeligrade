import "server-only";
import type { ReviewQuestion } from "@/components/results/result-review";
import type { OptionLabel } from "@/lib/omr/layout";
import type { ServerSupabase } from "@/lib/supabase/server";

export interface ResultDetail {
  id: string;
  center_id: string;
  status: string;
  source: "scan" | "manual";
  student_id: string | null;
  open_warning_count: number;
  warnings: Array<{ code: string; blocking: boolean; position?: number }>;
  score: number;
  max_score: number;
  percentage: number;
  passed: boolean;
  correct_count: number;
  incorrect_count: number;
  blank_count: number;
  submitted_at: string;
  finalized_at: string | null;
  voided_at: string | null;
  void_reason: string | null;
  scan_job_id: string | null;
  students: { first_name: string; last_name: string; student_code: string | null } | null;
  classes: { name: string } | null;
  centers: { name: string } | null;
  tests: {
    id: string;
    title: string;
    negative_marking: boolean;
    negative_points: number;
    passing_score: number;
    subjects: { name_kk: string; name_ru: string } | null;
  } | null;
  finalizer: { full_name: string } | null;
  reviewer: { full_name: string } | null;
}

/** Loads everything the review screen and the printable report need (RLS-scoped). */
export async function loadResultDetail(supabase: ServerSupabase, id: string) {
  const { data: result } = await supabase
    .from("assessment_results")
    .select(
      "id, center_id, status, source, student_id, open_warning_count, warnings, score, max_score, percentage, passed, correct_count, incorrect_count, blank_count, submitted_at, finalized_at, voided_at, void_reason, scan_job_id, students(first_name, last_name, student_code), classes(name), centers(name), tests(id, title, negative_marking, negative_points, passing_score, subjects(name_kk, name_ru)), finalizer:profiles!assessment_results_finalized_by_fkey(full_name), reviewer:profiles!assessment_results_reviewed_by_fkey(full_name)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!result) return null;
  const r = result as unknown as ResultDetail;
  if (!r.tests) return null;

  const [{ data: answers }, { data: questions }, { data: recognized }, { data: job }, { data: reviews }] = await Promise.all([
    supabase.from("result_answers").select("question_position, recognized_label, selected_label, recognition_status").eq("result_id", id),
    supabase.from("test_questions").select("position, question_type, points, answer_options(label), answer_keys(correct_label)").eq("test_id", r.tests.id).order("position"),
    r.scan_job_id
      ? supabase.from("recognized_answers").select("question_position, confidence, fill_levels").eq("scan_job_id", r.scan_job_id)
      : Promise.resolve({ data: [] }),
    r.scan_job_id
      ? supabase.from("scan_jobs").select("file_id, file_metadata(deleted_at)").eq("id", r.scan_job_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("result_reviews")
      .select("id, action, question_position, previous_value, new_value, previous_score, new_score, comment, created_at, profiles(full_name)")
      .eq("result_id", id)
      .order("created_at", { ascending: false }),
  ]);

  type A = { question_position: number; recognized_label: OptionLabel | null; selected_label: OptionLabel | null; recognition_status: ReviewQuestion["recognitionStatus"] };
  type Q = {
    position: number;
    question_type: string;
    points: number;
    answer_options: Array<{ label: string }>;
    answer_keys: { correct_label: OptionLabel } | Array<{ correct_label: OptionLabel }> | null;
  };
  type Rec = { question_position: number; confidence: number; fill_levels: Partial<Record<OptionLabel, number>> };
  const aMap = new Map(((answers ?? []) as A[]).map((a) => [a.question_position, a]));
  const recMap = new Map(((recognized ?? []) as Rec[]).map((x) => [x.question_position, x]));
  const reviewQuestions: ReviewQuestion[] = ((questions ?? []) as unknown as Q[]).map((q) => {
    const a = aMap.get(q.position);
    const rec = recMap.get(q.position);
    const key = Array.isArray(q.answer_keys) ? q.answer_keys[0] : q.answer_keys;
    return {
      position: q.position,
      optionCount: q.question_type === "true_false" ? 2 : Math.max(2, q.answer_options.length),
      points: Number(q.points),
      correct: (key?.correct_label ?? "A") as OptionLabel,
      recognized: a?.recognized_label ?? null,
      selected: a?.selected_label ?? null,
      recognitionStatus: a?.recognition_status ?? null,
      confidence: rec ? Number(rec.confidence) : null,
      fill: rec?.fill_levels ?? {},
    };
  });

  type Rv = {
    id: string;
    action: string;
    question_position: number | null;
    previous_value: string | null;
    new_value: string | null;
    previous_score: number | null;
    new_score: number | null;
    comment: string;
    created_at: string;
    profiles: { full_name: string } | null;
  };
  return {
    result: r,
    questions: reviewQuestions,
    // A photo removed by retention or voiding is reported as unavailable.
    fileId: (() => {
      const j = job as { file_id: string | null; file_metadata: { deleted_at: string | null } | null } | null;
      return j?.file_id && j.file_metadata && !j.file_metadata.deleted_at ? j.file_id : null;
    })(),
    reviews: (reviews ?? []) as unknown as Rv[],
  };
}
