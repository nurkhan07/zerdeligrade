import type { Metadata } from "next";
import Link from "next/link";
import { FilterBar, FilterInput } from "@/components/filters";
import { Card, CardHeader, EmptyState, PageHeader, StatCard } from "@/components/ui/card";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { requireContext } from "@/lib/auth/context";
import { formatDateTime, formatNumber, formatPercent } from "@/lib/i18n/format";
import { getI18n } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { searchPattern, str } from "@/lib/utils";
import { getAnalytics, periodRange } from "@/server/queries";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.network.title };
}

/** HQ-only. Access is enforced twice: requireContext("network") and RLS (is_hq_admin). */
export default async function NetworkPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireContext("network");
  const { t, locale } = await getI18n();
  const supabase = await createClient();
  const q = str((await searchParams).q).trim();
  const pattern = q.length >= 2 ? searchPattern(q) : null;

  const [{ data: centers }, { count: studentsTotal }, analytics, { data: lastScans }, found] = await Promise.all([
    supabase.from("centers").select("id, name, code, city, is_active, students(count)").order("name"),
    supabase.from("students").select("id", { count: "exact", head: true }).eq("status", "active"),
    getAnalytics(supabase, { ...periodRange(365) }),
    supabase.from("scan_jobs").select("center_id, created_at").order("created_at", { ascending: false }).limit(2000),
    pattern
      ? supabase
          .from("students")
          .select("id, first_name, last_name, student_code, status, classes(name), centers(name, code)")
          .or(`last_name.ilike.${pattern},first_name.ilike.${pattern},student_code.ilike.${pattern}`)
          .order("last_name")
          .limit(50)
      : Promise.resolve({ data: null }),
  ]);

  const last = new Map<string, string>();
  for (const s of lastScans ?? []) if (!last.has(s.center_id)) last.set(s.center_id, s.created_at);
  const byCenter = new Map((analytics?.by_center ?? []).map((c) => [c.center_id, c]));
  type C = { id: string; name: string; code: string; city: string; is_active: boolean; students: Array<{ count: number }> };
  type S = { id: string; first_name: string; last_name: string; student_code: string | null; classes: { name: string } | null; centers: { name: string; code: string } | null };

  return (
    <>
      <PageHeader title={t.network.title} subtitle={t.network.subtitle} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={t.dashboard.centers} value={formatNumber((centers ?? []).filter((c) => c.is_active).length, locale)} />
        <StatCard label={t.network.studentsTotal} value={formatNumber(studentsTotal ?? 0, locale)} />
        <StatCard label={t.analytics.resultsCount} value={formatNumber(analytics?.results_count ?? 0, locale)} />
        <StatCard label={t.analytics.avg} value={formatPercent(analytics?.avg_percentage ?? null, locale)} />
      </div>

      <Card className="mt-6">
        <CardHeader title={t.network.centerSummary} />
        <Table>
          <THead>
            <tr>
              <TH>{t.common.center}</TH>
              <TH>{t.centers.city}</TH>
              <TH className="text-right">{t.centers.students}</TH>
              <TH className="text-right">{t.network.results}</TH>
              <TH className="text-right">{t.analytics.avg}</TH>
              <TH>{t.network.lastActivity}</TH>
            </tr>
          </THead>
          <tbody>
            {((centers ?? []) as unknown as C[]).map((c) => {
              const a = byCenter.get(c.id);
              return (
                <TR key={c.id} className={c.is_active ? undefined : "opacity-60"}>
                  <TD className="font-medium">
                    {c.name} <span className="font-mono text-xs text-muted">{c.code}</span>
                  </TD>
                  <TD>{c.city || "—"}</TD>
                  <TD className="tabular text-right">{c.students?.[0]?.count ?? 0}</TD>
                  <TD className="tabular text-right">{a?.n ?? 0}</TD>
                  <TD className="tabular text-right">{formatPercent(a?.avg ?? null, locale)}</TD>
                  <TD className="text-muted">{formatDateTime(last.get(c.id) ?? null, locale)}</TD>
                </TR>
              );
            })}
          </tbody>
        </Table>
      </Card>

      <h2 className="mb-3 mt-8 text-lg font-semibold">{t.network.searchStudents}</h2>
      <FilterBar t={t} resetHref="/network">
        <FilterInput name="q" label={t.common.search} value={q} placeholder={t.students.searchPlaceholder} />
      </FilterBar>
      {found.data ? (
        <Card>
          {(found.data as unknown as S[]).length === 0 ? (
            <EmptyState title={t.common.noResults} />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>{t.common.student}</TH>
                  <TH>{t.students.code}</TH>
                  <TH>{t.common.class}</TH>
                  <TH>{t.common.center}</TH>
                </tr>
              </THead>
              <tbody>
                {(found.data as unknown as S[]).map((s) => (
                  <TR key={s.id}>
                    <TD className="font-medium">
                      <Link href={`/students/${s.id}`} className="hover:text-primary">
                        {s.last_name} {s.first_name}
                      </Link>
                    </TD>
                    <TD className="text-muted">{s.student_code ?? "—"}</TD>
                    <TD>{s.classes?.name ?? "—"}</TD>
                    <TD>{s.centers ? `${s.centers.name} (${s.centers.code})` : "—"}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      ) : (
        <p className="text-sm text-muted">{t.network.searchHint}</p>
      )}
    </>
  );
}
