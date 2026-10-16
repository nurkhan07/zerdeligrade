import { notFound } from "next/navigation";
import { PrintToolbar } from "@/components/print-toolbar";
import { formatDate, formatNumber, formatPercent } from "@/lib/i18n/format";
import { getI18n } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/utils";
import { subjectName } from "@/server/queries";
import { loadResultDetail } from "@/server/result-detail";

export default async function ResultReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { t, locale } = await getI18n();
  const supabase = await createClient();
  const detail = await loadResultDetail(supabase, id);
  if (!detail) notFound();
  const { result: r, questions } = detail;
  const statusLabel = t.results[`status_${r.status}` as "status_finalized"];

  return (
    <>
      <PrintToolbar title={`${t.results.reportTitle}: ${r.students ? `${r.students.last_name} ${r.students.first_name}` : ""}`} />
      <div className="flex justify-center py-6 print:block print:p-0">
        <article className="print-page bg-white p-[15mm] text-ink shadow-lg" style={{ width: "210mm", minHeight: "297mm" }}>
          <header className="flex items-start justify-between gap-6 border-b border-line pb-4">
            <div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/zerdeligrade-logo.png" alt="Zerdeli" className="mb-3 h-8 w-auto" />
              <p className="text-xs font-semibold uppercase tracking-wider text-brand">{t.results.reportTitle}</p>
              <h1 className="mt-1 text-xl font-semibold">{r.students ? `${r.students.last_name} ${r.students.first_name}` : t.results.noStudent}</h1>
              <p className="text-sm text-muted">{[r.classes?.name, r.centers?.name, r.students?.student_code].filter(Boolean).join(" · ")}</p>
            </div>
            <div className="text-right text-sm">
              <p className="font-medium">{r.tests?.title}</p>
              <p className="text-muted">{subjectName(r.tests?.subjects, locale)}</p>
              <p className="text-muted">{formatDate(r.submitted_at, locale)}</p>
              <p className="mt-1">{statusLabel}</p>
            </div>
          </header>
          <section className="my-6 grid grid-cols-4 gap-4 text-center">
            <div className="rounded-lg bg-surface p-3">
              <p className="text-xs text-muted">{t.results.score}</p>
              <p className="tabular text-lg font-semibold">
                {formatNumber(r.score, locale, 2)} / {formatNumber(r.max_score, locale, 2)}
              </p>
            </div>
            <div className="rounded-lg bg-surface p-3">
              <p className="text-xs text-muted">{t.results.percentage}</p>
              <p className="tabular text-lg font-semibold">{formatPercent(r.percentage, locale)}</p>
            </div>
            <div className="rounded-lg bg-surface p-3">
              <p className="text-xs text-muted">
                {t.results.correctCount} / {t.results.incorrectCount} / {t.results.blankCount}
              </p>
              <p className="tabular text-lg font-semibold">
                {r.correct_count} / {r.incorrect_count} / {r.blank_count}
              </p>
            </div>
            <div className="rounded-lg bg-surface p-3">
              <p className="text-xs text-muted">{t.tests.fieldPassing}</p>
              <p className="text-lg font-semibold">{r.passed ? t.results.passed : t.results.notPassed}</p>
            </div>
          </section>
          <h2 className="mb-2 text-sm font-semibold">{t.results.byQuestion}</h2>
          <div className="grid grid-cols-4 gap-x-4 text-xs">
            {questions.map((q) => {
              const ok = q.selected !== null && q.selected === q.correct;
              return (
                <div key={q.position} className="flex items-center justify-between border-b border-line py-1">
                  <span className="tabular w-6 font-semibold">{q.position}</span>
                  <span className="font-mono">{q.selected ?? "—"}</span>
                  <span className="font-mono text-muted">{q.correct}</span>
                  <span className={ok ? "text-success" : "text-danger"} aria-label={ok ? t.results.correctCount : t.results.incorrectCount}>
                    {ok ? "✓" : "✗"}
                  </span>
                </div>
              );
            })}
          </div>
        </article>
      </div>
    </>
  );
}
