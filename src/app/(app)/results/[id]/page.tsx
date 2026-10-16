import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ResultReview } from "@/components/results/result-review";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { requireContext } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { formatDateTime, formatNumber } from "@/lib/i18n/format";
import { getI18n } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/utils";
import { subjectName } from "@/server/queries";
import { loadResultDetail } from "@/server/result-detail";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.results.detailTitle };
}

export default async function ResultPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext("results");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { t, locale } = await getI18n();
  const supabase = await createClient();
  const detail = await loadResultDetail(supabase, id);
  if (!detail) notFound();
  const { result: r, questions, reviews, fileId } = detail;

  const { data: students } = await supabase
    .from("students")
    .select("id, first_name, last_name, classes(name)")
    .eq("center_id", r.center_id)
    .eq("status", "active")
    .order("last_name")
    .limit(5000);
  type St = { id: string; first_name: string; last_name: string; classes: { name: string } | null };
  const studentOptions = ((students ?? []) as unknown as St[]).map((s) => ({
    id: s.id,
    name: `${s.last_name} ${s.first_name}${s.classes ? ` · ${s.classes.name}` : ""}`,
  }));
  if (r.student_id && !studentOptions.some((s) => s.id === r.student_id) && r.students) {
    studentOptions.unshift({ id: r.student_id, name: `${r.students.last_name} ${r.students.first_name}` });
  }

  const actionLabel = (a: string) => (t.results as Record<string, string>)[`action_${a}`] ?? a;
  const sheetWarnings = (r.warnings ?? []).filter((w) => w.position === undefined);

  return (
    <>
      <PageHeader
        title={r.students ? `${r.students.last_name} ${r.students.first_name}` : t.results.noStudent}
        subtitle={[r.tests?.title, subjectName(r.tests?.subjects, locale), r.classes?.name, r.centers?.name, formatDateTime(r.submitted_at, locale)].filter(Boolean).join(" · ")}
        actions={
          <Link href="/results" className="text-sm text-primary hover:underline">
            ← {t.results.title}
          </Link>
        }
      />
      <ResultReview
        resultId={r.id}
        status={r.status}
        openWarnings={r.open_warning_count}
        sheetWarnings={sheetWarnings}
        studentId={r.student_id}
        students={studentOptions}
        questions={questions}
        rules={{ negativeMarking: r.tests!.negative_marking, negativePoints: Number(r.tests!.negative_points), passingScore: Number(r.tests!.passing_score) }}
        stored={{
          score: Number(r.score),
          maxScore: Number(r.max_score),
          percentage: Number(r.percentage),
          passed: r.passed,
          correct: r.correct_count,
          incorrect: r.incorrect_count,
          blank: r.blank_count,
        }}
        canFinalize={can.finalizeResults(ctx)}
        canReopen={can.reopenResults(ctx)}
        canVoid={r.status !== "voided" && (r.status !== "finalized" || can.reopenResults(ctx))}
        voidInfo={r.status === "voided" && r.voided_at ? { at: r.voided_at, reason: r.void_reason ?? "" } : null}
        photoUrl={fileId ? `/api/files/${fileId}` : null}
      />
      <Card className="mt-6">
        <CardHeader
          title={t.results.history}
          description={[
            r.reviewer ? `${t.results.reviewedBy}: ${r.reviewer.full_name}` : null,
            r.finalizer ? `${t.results.finalizedBy}: ${r.finalizer.full_name} (${formatDateTime(r.finalized_at, locale)})` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        />
        {reviews.length === 0 ? (
          <EmptyState title={t.results.noHistory} />
        ) : (
          <ul className="divide-y divide-line">
            {reviews.map((rv) => (
              <li key={rv.id} className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-3 text-sm">
                <div>
                  <span className="font-medium">{actionLabel(rv.action)}</span>
                  {rv.question_position ? (
                    <span className="text-muted">
                      {" "}
                      · {t.common.question} {rv.question_position}: {rv.previous_value ?? "—"} → {rv.new_value ?? "—"}
                    </span>
                  ) : null}
                  {rv.previous_score !== null && rv.new_score !== null && rv.action === "review" ? (
                    <span className="tabular text-muted">
                      {" "}
                      · {formatNumber(rv.previous_score, locale, 2)} → {formatNumber(rv.new_score, locale, 2)}
                    </span>
                  ) : null}
                  {rv.comment ? <p className="mt-0.5 text-muted">“{rv.comment}”</p> : null}
                </div>
                <span className="text-xs text-muted">
                  {rv.profiles?.full_name ?? t.common.unknownUser} · {formatDateTime(rv.created_at, locale)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
