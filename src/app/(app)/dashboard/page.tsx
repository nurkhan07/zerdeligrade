import type { Metadata } from "next";
import Link from "next/link";
import { Building2, ClipboardList, Hourglass, Percent, ScanLine, Users } from "lucide-react";
import { ColumnChart, HorizontalBarChart } from "@/components/charts";
import { FilterBar, FilterSelect } from "@/components/filters";
import { Badge, RESULT_STATUS_TONE } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState, PageHeader, StatCard } from "@/components/ui/card";
import { requireContext } from "@/lib/auth/context";
import { fmt } from "@/lib/i18n/config";
import { formatDateTime, formatNumber, formatPercent } from "@/lib/i18n/format";
import { getI18n } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { str, uuidParam } from "@/lib/utils";
import { getAnalytics, getClasses, getSubjects, periodRange, personName, subjectName } from "@/server/queries";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.dashboard.title };
}

type SP = Promise<Record<string, string | string[] | undefined>>;

function Delta({ current, previous, label, unit }: { current: number | null; previous: number | null; label: string; unit: string }) {
  if (current === null || previous === null) return null;
  const d = Math.round((current - previous) * 10) / 10;
  const sign = d > 0 ? "+" : "";
  return (
    <span className={d > 0 ? "text-success" : d < 0 ? "text-danger" : "text-muted"}>
      {sign}
      {d} {unit} <span className="text-muted">{label}</span>
    </span>
  );
}

export default async function DashboardPage({ searchParams }: { searchParams: SP }) {
  const ctx = await requireContext("dashboard");
  const { t, locale } = await getI18n();
  const supabase = await createClient();
  const sp = await searchParams;
  const days = [30, 90, 365].includes(Number(str(sp.period))) ? Number(str(sp.period)) : 90;
  const subject = uuidParam(sp.subject);
  const classId = uuidParam(sp.class);
  const center = ctx.activeCenterId;
  const range = periodRange(days);

  // Explicit center filter (RLS already limits rows; this narrows HQ to the chosen center).
  const cf: Record<string, string> = center ? { center_id: center } : {};

  const [students, tests, processed, pending, analytics, recentResults, recentScans, subjects, classes] = await Promise.all([
    supabase.from("students").select("id", { count: "exact", head: true }).eq("status", "active").match(cf),
    supabase.from("tests").select("id", { count: "exact", head: true }).eq("is_template", false).match(cf),
    supabase.from("scan_jobs").select("id", { count: "exact", head: true }).neq("status", "failed").match(cf),
    supabase.from("assessment_results").select("id", { count: "exact", head: true }).in("status", ["needs_review", "reviewed"]).match(cf),
    getAnalytics(supabase, { center, subject, classId, ...range }),
    supabase
        .from("assessment_results")
        .select("id, percentage, status, submitted_at, students(first_name, last_name), tests(title)")
        .neq("status", "voided")
        .order("submitted_at", { ascending: false })
        .limit(6)
        .match(cf),
    supabase
        .from("scan_jobs")
        .select("id, status, error_code, created_at, tests(title), assessment_results(id)")
        .order("created_at", { ascending: false })
        .limit(6)
        .match(cf),
    getSubjects(supabase),
    getClasses(supabase, center),
  ]);

  const a = analytics;
  const scope =
    ctx.role === "teacher"
      ? t.dashboard.scopeTeacher
      : center
        ? fmt(t.dashboard.scopeCenter, { center: ctx.activeCenter?.name ?? "" })
        : t.dashboard.scopeAll;

  type ResultItem = { id: string; percentage: number; status: string; submitted_at: string; students: { first_name: string; last_name: string } | null; tests: { title: string } | null };
  type ScanItem = { id: string; status: string; error_code: string | null; created_at: string; tests: { title: string } | null; assessment_results: Array<{ id: string }> | null };

  return (
    <>
      <PageHeader
        title={fmt(t.dashboard.hello, { name: ctx.fullName.split(" ")[0] ?? "" })}
        subtitle={scope}
        actions={
          <>
            <Button asChild variant="secondary">
              <Link href="/tests/new">
                <ClipboardList /> {t.dashboard.createTest}
              </Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/answer-sheets">{t.dashboard.printSheets}</Link>
            </Button>
            <Button asChild variant="accent">
              <Link href="/scan">
                <ScanLine /> {t.dashboard.scanSheets}
              </Link>
            </Button>
          </>
        }
      />

      <FilterBar t={t} resetHref="/dashboard">
        <FilterSelect
          name="period"
          label={t.dashboard.period}
          value={String(days)}
          options={[
            { value: "30", label: t.dashboard.last30 },
            { value: "90", label: t.dashboard.last90 },
            { value: "365", label: t.dashboard.last365 },
          ]}
        />
        <FilterSelect name="subject" label={t.common.subject} value={subject ?? ""} allLabel={t.common.all} options={subjects.map((s) => ({ value: s.id, label: subjectName(s, locale) }))} />
        <FilterSelect name="class" label={t.common.class} value={classId ?? ""} allLabel={t.common.all} options={classes.map((c) => ({ value: c.id, label: c.name }))} />
      </FilterBar>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label={t.dashboard.students} value={formatNumber(students.count ?? 0, locale)} icon={<Users />} />
        <StatCard label={t.dashboard.centers} value={formatNumber(center ? 1 : ctx.centers.length, locale)} icon={<Building2 />} />
        <StatCard label={t.dashboard.tests} value={formatNumber(tests.count ?? 0, locale)} icon={<ClipboardList />} />
        <StatCard label={t.dashboard.sheetsProcessed} value={formatNumber(processed.count ?? 0, locale)} icon={<ScanLine />} />
        <StatCard
          label={t.dashboard.avgScore}
          value={formatPercent(a?.avg_percentage ?? null, locale)}
          icon={<Percent />}
          hint={<Delta current={a?.avg_percentage ?? null} previous={a?.previous.avg_percentage ?? null} label={t.analytics.vsPrevious} unit={t.analytics.pp} />}
        />
        <StatCard
          label={t.dashboard.needsReview}
          value={
            <Link href="/results?status=needs_review" className="hover:text-primary">
              {formatNumber(pending.count ?? 0, locale)}
            </Link>
          }
          icon={<Hourglass />}
        />
      </div>

      <div className="mt-6 grid gap-6 grid-cols-1 xl:grid-cols-2">
        <Card>
          <CardHeader title={t.dashboard.bySubject} />
          <CardBody>
            {a && a.by_subject.length ? (
              <ColumnChart valueLabel={t.analytics.avg} data={a.by_subject.map((s) => ({ label: locale === "kk" ? s.name_kk : s.name_ru, value: Number(s.avg), n: s.n }))} />
            ) : (
              <EmptyState title={t.dashboard.noData} />
            )}
          </CardBody>
        </Card>
        {center === null && ctx.isHq ? (
          <Card>
            <CardHeader title={t.dashboard.centerComparison} />
            <CardBody>
              {a && a.by_center.length ? (
                <HorizontalBarChart valueLabel={t.analytics.avg} data={a.by_center.map((c) => ({ label: c.name, value: Number(c.avg), n: c.n }))} />
              ) : (
                <EmptyState title={t.dashboard.noData} />
              )}
            </CardBody>
          </Card>
        ) : (
          <Card>
            <CardHeader title={t.dashboard.byClass} />
            <CardBody>
              {a && a.by_class.length ? (
                <HorizontalBarChart valueLabel={t.analytics.avg} data={a.by_class.map((c) => ({ label: c.name, value: Number(c.avg), n: c.n }))} />
              ) : (
                <EmptyState title={t.dashboard.noData} />
              )}
            </CardBody>
          </Card>
        )}
      </div>

      <Card className="mt-6">
        <CardHeader title={t.dashboard.comparison} description={t.dashboard.comparisonHint} />
        <CardBody className="grid gap-4 sm:grid-cols-3">
          {(
            [
              [t.analytics.resultsCount, a?.results_count ?? 0, a?.previous.results_count ?? 0, "n"],
              [t.analytics.avg, a?.avg_percentage ?? null, a?.previous.avg_percentage ?? null, "%"],
              [t.analytics.passRate, a?.pass_rate ?? null, a?.previous.pass_rate ?? null, "%"],
            ] as const
          ).map(([label, cur, prev, kind]) => (
            <div key={label} className="rounded-[var(--radius-control)] bg-surface p-4">
              <p className="text-sm text-muted">{label}</p>
              <p className="tabular mt-1 text-xl font-semibold">
                {kind === "%" ? formatPercent(cur, locale) : formatNumber(cur, locale)}
                <span className="ml-2 text-sm font-normal text-muted">
                  ← {kind === "%" ? formatPercent(prev, locale) : formatNumber(prev, locale)}
                </span>
              </p>
            </div>
          ))}
        </CardBody>
      </Card>

      <div className="mt-6 grid gap-6 grid-cols-1 xl:grid-cols-2">
        <Card>
          <CardHeader title={t.dashboard.recentResults} actions={<Link className="text-sm text-primary hover:underline" href="/results">{t.common.view}</Link>} />
          {((recentResults.data ?? []) as unknown as ResultItem[]).length === 0 ? (
            <EmptyState title={t.results.empty} />
          ) : (
            <ul className="divide-y divide-line">
              {((recentResults.data ?? []) as unknown as ResultItem[]).map((r) => (
                <li key={r.id}>
                  <Link href={`/results/${r.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-surface/50">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{r.students ? personName(r.students) : t.results.noStudent}</p>
                      <p className="truncate text-xs text-muted">
                        {r.tests?.title} · {formatDateTime(r.submitted_at, locale)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="tabular text-sm font-semibold">{formatPercent(r.percentage, locale)}</span>
                      <Badge tone={RESULT_STATUS_TONE[r.status]}>{t.results[`status_${r.status}` as keyof typeof t.results]}</Badge>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title={t.dashboard.recentScans} actions={<Link className="text-sm text-primary hover:underline" href="/scan">{t.common.view}</Link>} />
          {((recentScans.data ?? []) as unknown as ScanItem[]).length === 0 ? (
            <EmptyState title={t.scan.noJobs} />
          ) : (
            <ul className="divide-y divide-line">
              {((recentScans.data ?? []) as unknown as ScanItem[]).map((j) => {
                const resultId = j.assessment_results?.[0]?.id;
                const body = (
                  <div className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{j.tests?.title}</p>
                      <p className="truncate text-xs text-muted">
                        {formatDateTime(j.created_at, locale)}
                        {j.error_code ? ` · ${t.recognition[j.error_code as keyof typeof t.recognition] ?? j.error_code}` : ""}
                      </p>
                    </div>
                    <Badge tone={RESULT_STATUS_TONE[j.status]}>{t.results[`status_${j.status}` as keyof typeof t.results]}</Badge>
                  </div>
                );
                return (
                  <li key={j.id}>
                    {resultId ? (
                      <Link href={`/results/${resultId}`} className="block hover:bg-surface/50">
                        {body}
                      </Link>
                    ) : (
                      body
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
