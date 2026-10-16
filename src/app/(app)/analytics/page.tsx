import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3, Download } from "lucide-react";
import { ColumnChart, HorizontalBarChart, TrendChart } from "@/components/charts";
import { FilterBar, FilterInput, FilterSelect } from "@/components/filters";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState, PageHeader, StatCard } from "@/components/ui/card";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { requireContext } from "@/lib/auth/context";
import { formatMonth, formatNumber, formatPercent } from "@/lib/i18n/format";
import { getI18n } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { str, uuidParam } from "@/lib/utils";
import { getAnalytics, getClasses, getSubjects, subjectName } from "@/server/queries";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.analytics.title };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext("analytics");
  const { t, locale } = await getI18n();
  const supabase = await createClient();
  const sp = await searchParams;
  const center = ctx.activeCenterId;
  const classId = uuidParam(sp.class);
  const subject = uuidParam(sp.subject);
  const test = uuidParam(sp.test);
  const today = new Date();
  const defFrom = new Date(today.getTime() - 180 * 86_400_000).toISOString().slice(0, 10);
  const fromS = DATE_RE.test(str(sp.from)) ? str(sp.from) : defFrom;
  const toS = DATE_RE.test(str(sp.to)) ? str(sp.to) : today.toISOString().slice(0, 10);
  const from = new Date(`${fromS}T00:00:00+05:00`);
  const to = new Date(`${toS}T23:59:59+05:00`);

  let testsQuery = supabase.from("tests").select("id, title").eq("is_template", false).neq("status", "draft").order("title").limit(500);
  if (center) testsQuery = testsQuery.eq("center_id", center);
  const [a, classes, subjects, { data: tests }] = await Promise.all([
    getAnalytics(supabase, { center, classId, subject, test, from, to }),
    getClasses(supabase, center),
    getSubjects(supabase),
    testsQuery,
  ]);

  const delta = (cur: number | null | undefined, prev: number | null | undefined) => {
    if (cur === null || cur === undefined || prev === null || prev === undefined) return null;
    const d = Math.round((Number(cur) - Number(prev)) * 10) / 10;
    return (
      <span className={d > 0 ? "text-success" : d < 0 ? "text-danger" : "text-muted"}>
        {d > 0 ? "+" : ""}
        {formatNumber(d, locale, 1)} {t.analytics.pp} <span className="text-muted">{t.analytics.vsPrevious}</span>
      </span>
    );
  };
  const exportQs = new URLSearchParams(
    Object.entries({ class: classId, subject, test, from: fromS, to: toS, status: "finalized" }).filter((e): e is [string, string] => Boolean(e[1])),
  ).toString();
  const has = a && a.results_count > 0;

  return (
    <>
      <PageHeader
        title={t.analytics.title}
        subtitle={t.analytics.subtitle}
        actions={
          <Button asChild variant="secondary">
            <a href={`/api/export/results?${exportQs}`}>
              <Download /> {t.analytics.exportResults}
            </a>
          </Button>
        }
      />
      <FilterBar t={t} resetHref="/analytics">
        <FilterInput name="from" type="date" label={t.common.from} value={fromS} />
        <FilterInput name="to" type="date" label={t.common.to} value={toS} />
        <FilterSelect name="class" label={t.common.class} value={classId ?? ""} allLabel={t.common.all} options={classes.map((c) => ({ value: c.id, label: c.name }))} />
        <FilterSelect name="subject" label={t.common.subject} value={subject ?? ""} allLabel={t.common.all} options={subjects.map((s) => ({ value: s.id, label: subjectName(s, locale) }))} />
        <FilterSelect name="test" label={t.common.test} value={test ?? ""} allLabel={t.common.all} options={(tests ?? []).map((x) => ({ value: x.id, label: x.title }))} />
      </FilterBar>

      {!has ? (
        <Card>
          <EmptyState icon={<BarChart3 />} title={t.analytics.noData} />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <StatCard label={t.analytics.resultsCount} value={formatNumber(a.results_count, locale)} hint={`← ${formatNumber(a.previous.results_count, locale)}`} />
            <StatCard label={t.analytics.testsCount} value={formatNumber(a.tests_count, locale)} />
            <StatCard label={t.analytics.studentsCount} value={formatNumber(a.students_count, locale)} />
            <StatCard label={t.analytics.avg} value={formatPercent(a.avg_percentage, locale)} hint={delta(a.avg_percentage, a.previous.avg_percentage)} />
            <StatCard label={t.analytics.passRate} value={formatPercent(a.pass_rate, locale)} hint={delta(a.pass_rate, a.previous.pass_rate)} />
          </div>

          <div className="mt-6 grid gap-6 grid-cols-1 xl:grid-cols-2">
            <Card>
              <CardHeader title={t.analytics.bySubject} />
              <CardBody>
                <ColumnChart valueLabel={t.analytics.avg} data={a.by_subject.map((s) => ({ label: locale === "kk" ? s.name_kk : s.name_ru, value: Number(s.avg), n: s.n }))} />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title={t.analytics.byClass} />
              <CardBody>
                {a.by_class.length ? (
                  <HorizontalBarChart valueLabel={t.analytics.avg} data={a.by_class.map((c) => ({ label: c.name, value: Number(c.avg), n: c.n }))} />
                ) : (
                  <EmptyState title={t.analytics.noData} />
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title={t.analytics.distribution} />
              <CardBody>
                <ColumnChart
                  valueLabel={t.analytics.attempts}
                  unit=""
                  max={Math.max(1, ...a.distribution.map((d) => d.n))}
                  data={a.distribution.map((d) => ({ label: d.bucket === 9 ? "90–100" : `${d.bucket * 10}–${d.bucket * 10 + 9}`, value: d.n }))}
                />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title={t.analytics.progress} />
              <CardBody>
                <TrendChart valueLabel={t.analytics.avg} data={a.by_month.map((m) => ({ label: formatMonth(m.month, locale), value: Number(m.avg), n: m.n }))} />
              </CardBody>
            </Card>
          </div>

          <div className="mt-6 grid gap-6 grid-cols-1 xl:grid-cols-2">
            <Card>
              <CardHeader title={t.analytics.difficult} />
              <Table>
                <THead>
                  <tr>
                    <TH>{t.common.test}</TH>
                    <TH className="text-right">{t.common.question}</TH>
                    <TH className="text-right">{t.analytics.correctRate}</TH>
                    <TH className="text-right">{t.analytics.attempts}</TH>
                  </tr>
                </THead>
                <tbody>
                  {a.difficult_questions.map((q) => (
                    <TR key={`${q.test_id}-${q.position}`}>
                      <TD>
                        <Link href={`/tests/${q.test_id}`} className="hover:text-primary">
                          {q.title}
                        </Link>
                      </TD>
                      <TD className="tabular text-right">{q.position}</TD>
                      <TD className="tabular text-right font-medium">{formatPercent(q.correct_rate, locale)}</TD>
                      <TD className="tabular text-right text-muted">{q.n}</TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </Card>
            <Card>
              <CardHeader title={t.analytics.commonWrong} />
              <Table>
                <THead>
                  <tr>
                    <TH>{t.common.test}</TH>
                    <TH className="text-right">{t.common.question}</TH>
                    <TH className="text-right">{t.analytics.chosen}</TH>
                    <TH className="text-right">{t.results.correct}</TH>
                    <TH className="text-right">{t.analytics.times}</TH>
                  </tr>
                </THead>
                <tbody>
                  {a.common_wrong.map((q) => (
                    <TR key={`${q.test_id}-${q.position}-${q.label}`}>
                      <TD>{q.title}</TD>
                      <TD className="tabular text-right">{q.position}</TD>
                      <TD className="text-right font-mono font-semibold text-danger">{q.label}</TD>
                      <TD className="text-right font-mono">{q.correct_label}</TD>
                      <TD className="tabular text-right">{q.n}</TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </Card>
          </div>

          {!center && ctx.isHq && a.by_center.length ? (
            <Card className="mt-6">
              <CardHeader title={t.analytics.centers} />
              <Table>
                <THead>
                  <tr>
                    <TH>{t.common.center}</TH>
                    <TH className="text-right">{t.analytics.resultsCount}</TH>
                    <TH className="text-right">{t.analytics.studentsCount}</TH>
                    <TH className="text-right">{t.analytics.avg}</TH>
                  </tr>
                </THead>
                <tbody>
                  {a.by_center.map((c) => (
                    <TR key={c.center_id}>
                      <TD className="font-medium">{c.name}</TD>
                      <TD className="tabular text-right">{c.n}</TD>
                      <TD className="tabular text-right">{c.students}</TD>
                      <TD className="tabular text-right font-medium">{formatPercent(c.avg, locale)}</TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </Card>
          ) : null}
        </>
      )}
    </>
  );
}
