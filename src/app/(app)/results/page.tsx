import type { Metadata } from "next";
import { Download, ListChecks } from "lucide-react";
import { FilterBar, FilterInput, FilterSelect } from "@/components/filters";
import { ResultsTable, type ResultListRow } from "@/components/results/results-table";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, Notice, PageHeader } from "@/components/ui/card";
import { Pagination } from "@/components/ui/pagination";
import { requireContext } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { getI18n } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { pageParam } from "@/lib/utils";
import { parseResultFilters, RESULT_FILTER_STATUSES as STATUSES } from "@/server/result-filters";
import { getClasses, getSubjects, subjectName } from "@/server/queries";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.results.title };
}

const PAGE_SIZE = 30;
export default async function ResultsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext("results");
  const { t, locale } = await getI18n();
  const supabase = await createClient();
  const sp = await searchParams;
  const f = parseResultFilters(sp);
  const page = pageParam(sp.page);
  const center = ctx.activeCenterId;

  let query = supabase
    .from("assessment_results")
    .select(
      "id, score, max_score, percentage, status, open_warning_count, submitted_at, source, is_demo, students(first_name, last_name), classes(name), centers(code), tests!inner(title, subject_id)",
      { count: "exact" },
    )
    .order("submitted_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (center) query = query.eq("center_id", center);
  // Voided results are hidden unless explicitly requested.
  query = f.status ? query.eq("status", f.status) : query.neq("status", "voided");
  if (f.classId) query = query.eq("class_id", f.classId);
  if (f.test) query = query.eq("test_id", f.test);
  if (f.subject) query = query.eq("tests.subject_id", f.subject);
  if (f.from) query = query.gte("submitted_at", `${f.from}T00:00:00+05:00`);
  if (f.to) query = query.lte("submitted_at", `${f.to}T23:59:59+05:00`);

  let testsQuery = supabase.from("tests").select("id, title").eq("is_template", false).neq("status", "draft").order("title").limit(500);
  if (center) testsQuery = testsQuery.eq("center_id", center);

  const [{ data, count, error }, classes, subjects, { data: tests }] = await Promise.all([query, getClasses(supabase, center), getSubjects(supabase), testsQuery]);

  type R = {
    id: string;
    score: number;
    max_score: number;
    percentage: number;
    status: string;
    open_warning_count: number;
    submitted_at: string;
    source: "scan" | "manual";
    is_demo: boolean;
    students: { first_name: string; last_name: string } | null;
    classes: { name: string } | null;
    centers: { code: string } | null;
    tests: { title: string } | null;
  };
  const rows: ResultListRow[] = ((data ?? []) as unknown as R[]).map((r) => ({
    id: r.id,
    student: r.students ? `${r.students.last_name} ${r.students.first_name}` : null,
    className: r.classes?.name ?? null,
    test: r.tests?.title ?? "—",
    centerCode: r.centers?.code ?? null,
    score: Number(r.score),
    maxScore: Number(r.max_score),
    percentage: Number(r.percentage),
    status: r.status,
    openWarnings: r.open_warning_count,
    submittedAt: r.submitted_at,
    source: r.source,
    isDemo: r.is_demo,
  }));
  const params = {
    status: f.status || undefined,
    class: f.classId ?? undefined,
    subject: f.subject ?? undefined,
    test: f.test ?? undefined,
    from: f.from || undefined,
    to: f.to || undefined,
  };
  const exportQs = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => Boolean(e[1]))).toString();

  return (
    <>
      <PageHeader
        title={t.results.title}
        subtitle={t.results.subtitle}
        actions={
          <Button asChild variant="secondary">
            <a href={`/api/export/results${exportQs ? `?${exportQs}` : ""}`}>
              <Download /> {t.common.export}
            </a>
          </Button>
        }
      />
      <FilterBar t={t} resetHref="/results">
        <FilterSelect
          name="status"
          label={t.common.status}
          value={f.status}
          allLabel={t.common.all}
          options={STATUSES.map((s) => ({ value: s, label: t.results[`status_${s}`] }))}
        />
        <FilterSelect name="class" label={t.common.class} value={f.classId ?? ""} allLabel={t.common.all} options={classes.map((c) => ({ value: c.id, label: c.name }))} />
        <FilterSelect name="subject" label={t.common.subject} value={f.subject ?? ""} allLabel={t.common.all} options={subjects.map((s) => ({ value: s.id, label: subjectName(s, locale) }))} />
        <FilterSelect name="test" label={t.common.test} value={f.test ?? ""} allLabel={t.common.all} options={(tests ?? []).map((x) => ({ value: x.id, label: x.title }))} />
        <FilterInput name="from" type="date" label={t.common.from} value={f.from} />
        <FilterInput name="to" type="date" label={t.common.to} value={f.to} />
      </FilterBar>
      <Card>
        {error ? (
          <div className="p-5">
            <Notice tone="danger">{t.common.errorGeneric}</Notice>
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<ListChecks />} title={Object.values(params).some(Boolean) ? t.common.noResults : t.results.empty} />
        ) : (
          <>
            <ResultsTable rows={rows} showCenter={!center} canFinalize={can.finalizeResults(ctx)} />
            <Pagination t={t} page={page} pageSize={PAGE_SIZE} total={count ?? 0} basePath="/results" params={params} />
          </>
        )}
      </Card>
    </>
  );
}
