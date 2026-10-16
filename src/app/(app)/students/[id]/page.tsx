import { notFound } from "next/navigation";
import Link from "next/link";
import { TrendChart } from "@/components/charts";
import { Badge, RESULT_STATUS_TONE } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { requireContext } from "@/lib/auth/context";
import { formatDate, formatNumber, formatPercent } from "@/lib/i18n/format";
import { getI18n } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/utils";
import { subjectName } from "@/server/queries";

export default async function StudentPage({ params }: { params: Promise<{ id: string }> }) {
  await requireContext("students");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { t, locale } = await getI18n();
  const supabase = await createClient();
  const [{ data: student }, { data: results }] = await Promise.all([
    supabase.from("students").select("id, first_name, last_name, student_code, status, classes(name), centers(name)").eq("id", id).maybeSingle(),
    supabase
      .from("assessment_results")
      .select("id, score, max_score, percentage, status, submitted_at, tests(title, subjects(name_kk, name_ru))")
      .eq("student_id", id)
      .order("submitted_at", { ascending: true })
      .limit(500),
  ]);
  if (!student) notFound();

  type S = { first_name: string; last_name: string; student_code: string | null; status: string; classes: { name: string } | null; centers: { name: string } | null };
  type R = { id: string; score: number; max_score: number; percentage: number; status: string; submitted_at: string; tests: { title: string; subjects: { name_kk: string; name_ru: string } | null } | null };
  const s = student as unknown as S;
  const rows = (results ?? []) as unknown as R[];
  const finalized = rows.filter((r) => r.status === "finalized");

  return (
    <>
      <PageHeader
        title={`${s.last_name} ${s.first_name}`}
        subtitle={[s.classes?.name, s.centers?.name, s.student_code].filter(Boolean).join(" · ")}
        actions={<Badge tone={s.status === "active" ? "success" : "neutral"}>{t.students[`status_${s.status}` as "status_active"]}</Badge>}
      />
      <Card className="mb-6">
        <CardHeader title={t.students.progress} />
        <CardBody>
          {finalized.length ? (
            <TrendChart
              valueLabel={t.results.percentage}
              data={finalized.map((r) => ({ label: `${formatDate(r.submitted_at, locale)} · ${r.tests?.title ?? ""}`.slice(0, 40), value: Number(r.percentage) }))}
            />
          ) : (
            <EmptyState title={t.students.noResults} />
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t.results.title} />
        {rows.length === 0 ? (
          <EmptyState title={t.students.noResults} />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>{t.common.date}</TH>
                <TH>{t.common.test}</TH>
                <TH>{t.common.subject}</TH>
                <TH className="text-right">{t.results.score}</TH>
                <TH className="text-right">{t.results.percentage}</TH>
                <TH>{t.common.status}</TH>
              </tr>
            </THead>
            <tbody>
              {[...rows].reverse().map((r) => (
                <TR key={r.id}>
                  <TD>{formatDate(r.submitted_at, locale)}</TD>
                  <TD>
                    <Link href={`/results/${r.id}`} className="font-medium hover:text-primary">
                      {r.tests?.title}
                    </Link>
                  </TD>
                  <TD>{subjectName(r.tests?.subjects, locale)}</TD>
                  <TD className="tabular text-right">
                    {formatNumber(r.score, locale, 2)} / {formatNumber(r.max_score, locale, 2)}
                  </TD>
                  <TD className="tabular text-right font-medium">{formatPercent(r.percentage, locale)}</TD>
                  <TD>
                    <Badge tone={RESULT_STATUS_TONE[r.status]}>{t.results[`status_${r.status}` as "status_finalized"]}</Badge>
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
