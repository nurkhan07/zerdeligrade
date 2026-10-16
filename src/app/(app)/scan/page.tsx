import type { Metadata } from "next";
import Link from "next/link";
import { ScanLine } from "lucide-react";
import { ManualEntryDialog } from "@/components/scan/manual-entry";
import { ScanUploader } from "@/components/scan/scan-uploader";
import { Badge, RESULT_STATUS_TONE } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, EmptyState, Notice, PageHeader } from "@/components/ui/card";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { requireContext } from "@/lib/auth/context";
import { formatDateTime } from "@/lib/i18n/format";
import { getI18n } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.scan.title };
}

export default async function ScanPage() {
  const ctx = await requireContext("scan");
  const { t, locale } = await getI18n();
  const supabase = await createClient();
  const center = ctx.activeCenterId;

  let testQuery = supabase
    .from("tests")
    .select("id, title, test_questions(position, question_type, answer_options(label))")
    .eq("status", "published")
    .eq("is_template", false)
    .order("published_at", { ascending: false })
    .limit(200);
  if (center) testQuery = testQuery.eq("center_id", center);
  let jobQuery = supabase
    .from("scan_jobs")
    .select("id, status, error_code, created_at, tests(title), assessment_results(id, students(first_name, last_name))")
    .order("created_at", { ascending: false })
    .limit(25);
  if (center) jobQuery = jobQuery.eq("center_id", center);
  let studentQuery = supabase.from("students").select("id, first_name, last_name").eq("status", "active").order("last_name").limit(5000);
  if (center) studentQuery = studentQuery.eq("center_id", center);

  const [{ data: tests }, { data: jobs }, { data: students }] = await Promise.all([testQuery, jobQuery, studentQuery]);

  type T = { id: string; title: string; test_questions: Array<{ position: number; question_type: string; answer_options: Array<{ label: string }> }> };
  const testList = ((tests ?? []) as unknown as T[]).map((x) => ({
    id: x.id,
    title: x.title,
    optionCounts: [...x.test_questions]
      .sort((a, b) => a.position - b.position)
      .map((q) => (q.question_type === "true_false" ? 2 : Math.max(2, q.answer_options.length))),
  }));
  type J = {
    id: string;
    status: string;
    error_code: string | null;
    created_at: string;
    tests: { title: string } | null;
    assessment_results: Array<{ id: string; students: { first_name: string; last_name: string } | null }>;
  };
  const jobRows = (jobs ?? []) as unknown as J[];

  return (
    <>
      <PageHeader
        title={t.scan.title}
        subtitle={t.scan.subtitle}
        actions={<ManualEntryDialog tests={testList} students={(students ?? []).map((s) => ({ id: s.id, name: `${s.last_name} ${s.first_name}` }))} />}
      />
      <div className="grid gap-6 grid-cols-1 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardBody>
            {testList.length ? <ScanUploader tests={testList.map(({ id, title }) => ({ id, title }))} /> : <Notice>{t.sheets.onlyPublished}</Notice>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t.scan.tipsTitle} />
          <CardBody>
            <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm text-ink">
              {t.scan.tips.map((tip) => (
                <li key={tip}>{tip}</li>
              ))}
            </ol>
          </CardBody>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title={t.scan.recentJobs} />
        {jobRows.length === 0 ? (
          <EmptyState icon={<ScanLine />} title={t.scan.noJobs} />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>{t.common.date}</TH>
                <TH>{t.common.test}</TH>
                <TH>{t.common.student}</TH>
                <TH>{t.common.status}</TH>
                <TH className="text-right">{t.common.actions}</TH>
              </tr>
            </THead>
            <tbody>
              {jobRows.map((j) => {
                const r = j.assessment_results?.[0];
                return (
                  <TR key={j.id}>
                    <TD className="whitespace-nowrap text-muted">{formatDateTime(j.created_at, locale)}</TD>
                    <TD>{j.tests?.title}</TD>
                    <TD>{r?.students ? `${r.students.last_name} ${r.students.first_name}` : <span className="text-muted">—</span>}</TD>
                    <TD>
                      <Badge tone={RESULT_STATUS_TONE[j.status]}>{t.results[`status_${j.status}` as "status_failed"]}</Badge>
                      {j.error_code && j.error_code in t.recognition ? (
                        <p className="mt-1 text-xs text-danger">{t.recognition[j.error_code as keyof typeof t.recognition]}</p>
                      ) : null}
                    </TD>
                    <TD className="text-right">
                      {r ? (
                        <Link href={`/results/${r.id}`} className="text-sm text-primary hover:underline">
                          {t.scan.openReview}
                        </Link>
                      ) : null}
                    </TD>
                  </TR>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
