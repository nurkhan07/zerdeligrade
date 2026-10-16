import "server-only";
import type { Locale } from "@/lib/i18n/config";
import type { ServerSupabase } from "@/lib/supabase/server";

export interface Subject {
  id: string;
  code: string;
  name_kk: string;
  name_ru: string;
  is_active: boolean;
}

export interface ClassRow {
  id: string;
  center_id: string;
  name: string;
  kind: "class" | "group";
  grade: number | null;
  academic_year: string;
  is_active: boolean;
  is_demo: boolean;
}

export interface TestRow {
  id: string;
  center_id: string | null;
  is_template: boolean;
  title: string;
  subject_id: string;
  grade: number | null;
  language: Locale;
  instructions: string;
  question_count: number;
  negative_marking: boolean;
  negative_points: number;
  passing_score: number;
  time_limit_minutes: number | null;
  status: "draft" | "published" | "archived";
  created_by: string | null;
  created_at: string;
  published_at: string | null;
  is_demo: boolean;
}

export interface AnalyticsOverview {
  results_count: number;
  tests_count: number;
  students_count: number;
  avg_percentage: number | null;
  pass_rate: number | null;
  previous: { results_count: number; avg_percentage: number | null; pass_rate: number | null };
  by_subject: Array<{ subject_id: string; name_kk: string; name_ru: string; avg: number; n: number }>;
  by_class: Array<{ class_id: string; name: string; avg: number; n: number }>;
  by_center: Array<{ center_id: string; name: string; avg: number; n: number; students: number }>;
  distribution: Array<{ bucket: number; n: number }>;
  by_month: Array<{ month: string; avg: number; n: number }>;
  difficult_questions: Array<{ test_id: string; title: string; position: number; correct_rate: number; n: number }>;
  common_wrong: Array<{ test_id: string; title: string; position: number; label: string; correct_label: string; n: number }>;
}

export function subjectName(s: Pick<Subject, "name_kk" | "name_ru"> | null | undefined, locale: Locale): string {
  if (!s) return "—";
  return locale === "kk" ? s.name_kk : s.name_ru;
}

export async function getSubjects(supabase: ServerSupabase): Promise<Subject[]> {
  const { data } = await supabase.from("subjects").select("id, code, name_kk, name_ru, is_active").order("code");
  return (data ?? []) as Subject[];
}

export async function getClasses(supabase: ServerSupabase, centerId: string | null): Promise<ClassRow[]> {
  let q = supabase.from("classes").select("id, center_id, name, kind, grade, academic_year, is_active, is_demo").order("name");
  if (centerId) q = q.eq("center_id", centerId);
  const { data } = await q;
  return (data ?? []) as ClassRow[];
}

export async function getAnalytics(
  supabase: ServerSupabase,
  f: { center?: string | null; classId?: string | null; subject?: string | null; test?: string | null; from?: Date; to?: Date },
): Promise<AnalyticsOverview | null> {
  const { data, error } = await supabase.rpc("analytics_overview", {
    p_center: f.center ?? null,
    p_class: f.classId ?? null,
    p_subject: f.subject ?? null,
    p_test: f.test ?? null,
    p_from: f.from?.toISOString() ?? null,
    p_to: f.to?.toISOString() ?? null,
  });
  if (error) {
    console.error(JSON.stringify({ level: "error", scope: "analytics_overview", message: error.message }));
    return null;
  }
  return data as AnalyticsOverview;
}

/** Period presets used by dashboard and analytics filters. */
export function periodRange(days: number): { from: Date; to: Date } {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  return { from, to };
}

export function personName(p: { last_name: string; first_name: string } | null | undefined): string {
  return p ? `${p.last_name} ${p.first_name}` : "—";
}
