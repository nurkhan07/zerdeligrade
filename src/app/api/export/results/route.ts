import { NextResponse, type NextRequest } from "next/server";
import { audit } from "@/lib/audit";
import { getAppContext } from "@/lib/auth/context";
import { csvResponseHeaders, toCsv } from "@/lib/csv/write";
import { logError } from "@/lib/errors";
import { getI18n } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { parseResultFilters } from "@/server/result-filters";

export const runtime = "nodejs";
const MAX_ROWS = 20000;

export async function GET(request: NextRequest) {
  const ctx = await getAppContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { t, locale } = await getI18n();
  const f = parseResultFilters(Object.fromEntries(request.nextUrl.searchParams));
  const supabase = await createClient();

  let q = supabase
    .from("assessment_results")
    .select(
      "id, submitted_at, status, source, score, max_score, percentage, passed, correct_count, incorrect_count, blank_count, students(last_name, first_name, student_code), classes(name), centers(code), tests!inner(title, subject_id, subjects(name_kk, name_ru))",
    )
    .order("submitted_at", { ascending: false })
    .limit(MAX_ROWS);
  if (ctx.activeCenterId) q = q.eq("center_id", ctx.activeCenterId);
  q = f.status ? q.eq("status", f.status) : q.neq("status", "voided");
  if (f.classId) q = q.eq("class_id", f.classId);
  if (f.test) q = q.eq("test_id", f.test);
  if (f.subject) q = q.eq("tests.subject_id", f.subject);
  if (f.from) q = q.gte("submitted_at", `${f.from}T00:00:00+05:00`);
  if (f.to) q = q.lte("submitted_at", `${f.to}T23:59:59+05:00`);

  const { data, error } = await q;
  if (error) {
    logError("export.results", error);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
  type R = {
    id: string;
    submitted_at: string;
    status: string;
    source: string;
    score: number;
    max_score: number;
    percentage: number;
    passed: boolean;
    correct_count: number;
    incorrect_count: number;
    blank_count: number;
    students: { last_name: string; first_name: string; student_code: string | null } | null;
    classes: { name: string } | null;
    centers: { code: string } | null;
    tests: { title: string; subjects: { name_kk: string; name_ru: string } | null } | null;
  };
  const rows = ((data ?? []) as unknown as R[]).map((r) => [
    r.submitted_at.slice(0, 10),
    r.centers?.code ?? "",
    r.classes?.name ?? "",
    r.students?.last_name ?? "",
    r.students?.first_name ?? "",
    r.students?.student_code ?? "",
    r.tests?.title ?? "",
    r.tests?.subjects ? (locale === "kk" ? r.tests.subjects.name_kk : r.tests.subjects.name_ru) : "",
    Number(r.score),
    Number(r.max_score),
    Number(r.percentage),
    r.passed ? t.common.yes : t.common.no,
    r.correct_count,
    r.incorrect_count,
    r.blank_count,
    t.results[`status_${r.status}` as "status_finalized"] ?? r.status,
    r.source === "manual" ? t.results.source_manual : t.results.source_scan,
    r.id,
  ]);
  const header = [
    t.common.date,
    t.common.center,
    t.common.class,
    t.students.lastName,
    t.students.firstName,
    t.students.code,
    t.common.test,
    t.common.subject,
    t.results.score,
    t.tests.maxScore,
    t.results.percentage,
    t.results.passed,
    t.results.correctCount,
    t.results.incorrectCount,
    t.results.blankCount,
    t.common.status,
    "source",
    "id",
  ];
  await audit({ actorId: ctx.userId, centerId: ctx.activeCenterId, action: "export.results", entityType: "export", details: { rows: rows.length, filters: f } });
  return new NextResponse(toCsv(header, rows), { headers: csvResponseHeaders(`zerdeligrade-results-${new Date().toISOString().slice(0, 10)}.csv`) });
}
