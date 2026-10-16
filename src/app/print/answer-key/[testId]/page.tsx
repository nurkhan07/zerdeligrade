import { notFound } from "next/navigation";
import { PrintToolbar } from "@/components/print-toolbar";
import { formatDate, formatNumber } from "@/lib/i18n/format";
import { getI18n } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/utils";
import { subjectName } from "@/server/queries";

export default async function AnswerKeyPage({ params }: { params: Promise<{ testId: string }> }) {
  const { testId } = await params;
  if (!isUuid(testId)) notFound();
  const { t, locale } = await getI18n();
  const supabase = await createClient();
  const [{ data: test }, { data: questions }] = await Promise.all([
    supabase.from("tests").select("title, question_count, passing_score, negative_marking, negative_points, subjects(name_kk, name_ru), centers(name)").eq("id", testId).maybeSingle(),
    supabase.from("test_questions").select("position, question_type, points, answer_keys(correct_label)").eq("test_id", testId).order("position"),
  ]);
  if (!test) notFound();
  type T = { title: string; passing_score: number; negative_marking: boolean; negative_points: number; subjects: { name_kk: string; name_ru: string } | null; centers: { name: string } | null };
  type Q = { position: number; question_type: string; points: number; answer_keys: { correct_label: string } | Array<{ correct_label: string }> | null };
  const tt = test as unknown as T;
  const qs = (questions ?? []) as unknown as Q[];
  const key = (q: Q) => (Array.isArray(q.answer_keys) ? q.answer_keys[0]?.correct_label : q.answer_keys?.correct_label) ?? "—";
  const max = qs.reduce((s, q) => s + Number(q.points), 0);

  return (
    <>
      <PrintToolbar title={`${t.sheets.keyTitle}: ${tt.title}`} note={t.sheets.keyConfidential} />
      <div className="flex justify-center py-6 print:block print:p-0">
        <article className="print-page bg-white p-[15mm] shadow-lg" style={{ width: "210mm", minHeight: "297mm" }}>
          <header className="mb-6 flex items-start justify-between gap-6 border-b border-line pb-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-brand">ZerdeliGrade · {t.sheets.keyTitle}</p>
              <h1 className="mt-1 text-xl font-semibold">{tt.title}</h1>
              <p className="text-sm text-muted">
                {subjectName(tt.subjects, locale)} {tt.centers?.name ? `· ${tt.centers.name}` : ""} · {formatDate(new Date(), locale)}
              </p>
            </div>
            <div className="text-right text-sm">
              <p>
                {t.tests.maxScore}: <b className="tabular">{formatNumber(max, locale, 2)}</b>
              </p>
              <p>
                {t.tests.fieldPassing}: <b className="tabular">{formatNumber(tt.passing_score, locale, 2)}</b>
              </p>
              {tt.negative_marking ? (
                <p>
                  {t.tests.fieldNegativePoints}: <b className="tabular">−{formatNumber(tt.negative_points, locale, 2)}</b>
                </p>
              ) : null}
            </div>
          </header>
          <p className="mb-4 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{t.sheets.keyConfidential}</p>
          <div className="grid grid-cols-4 gap-x-6 gap-y-1 text-sm">
            {qs.map((q) => (
              <div key={q.position} className="flex items-center justify-between border-b border-line py-1">
                <span className="tabular w-8 font-semibold">{q.position}.</span>
                <span className="font-mono text-base font-bold">{key(q)}</span>
                <span className="tabular text-xs text-muted">
                  {formatNumber(q.points, locale, 2)}
                  {q.question_type === "true_false" ? " · T/F" : ""}
                </span>
              </div>
            ))}
          </div>
        </article>
      </div>
    </>
  );
}
