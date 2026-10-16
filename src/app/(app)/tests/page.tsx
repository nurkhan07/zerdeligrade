import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList, Plus } from "lucide-react";
import { FilterBar, FilterInput, FilterSelect } from "@/components/filters";
import { Badge, TEST_STATUS_TONE } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, Notice, PageHeader } from "@/components/ui/card";
import { Pagination } from "@/components/ui/pagination";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { requireContext } from "@/lib/auth/context";
import { formatDate } from "@/lib/i18n/format";
import { getI18n } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { pageParam, searchPattern, str, uuidParam } from "@/lib/utils";
import { getSubjects, subjectName } from "@/server/queries";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.tests.title };
}

const PAGE_SIZE = 25;
const STATUS_KEY = { draft: "statusDraft", published: "statusPublished", archived: "statusArchived" } as const;

export default async function TestsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext("tests");
  const { t, locale } = await getI18n();
  const supabase = await createClient();
  const sp = await searchParams;
  const q = str(sp.q);
  const status = ["draft", "published", "archived"].includes(str(sp.status)) ? (str(sp.status) as keyof typeof STATUS_KEY) : "";
  const subject = uuidParam(sp.subject);
  const page = pageParam(sp.page);

  let query = supabase
    .from("tests")
    .select("id, title, status, question_count, grade, language, created_at, is_demo, subjects(name_kk, name_ru), centers(code), test_assignments(count)", { count: "exact" })
    .eq("is_template", false)
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (ctx.activeCenterId) query = query.eq("center_id", ctx.activeCenterId);
  if (status) query = query.eq("status", status);
  if (subject) query = query.eq("subject_id", subject);
  const pattern = searchPattern(q);
  if (pattern) query = query.ilike("title", pattern.replaceAll("*", "%"));

  const [{ data, count, error }, subjects] = await Promise.all([query, getSubjects(supabase)]);
  type Row = {
    id: string;
    title: string;
    status: keyof typeof STATUS_KEY;
    question_count: number;
    grade: number | null;
    language: "kk" | "ru";
    created_at: string;
    is_demo: boolean;
    subjects: { name_kk: string; name_ru: string } | null;
    centers: { code: string } | null;
    test_assignments: Array<{ count: number }>;
  };
  const rows = (data ?? []) as unknown as Row[];

  return (
    <>
      <PageHeader
        title={t.tests.title}
        subtitle={t.tests.subtitle}
        actions={
          <Button asChild>
            <Link href="/tests/new">
              <Plus /> {t.tests.new}
            </Link>
          </Button>
        }
      />
      <FilterBar t={t} resetHref="/tests">
        <FilterInput name="q" label={t.common.search} value={q} />
        <FilterSelect
          name="status"
          label={t.tests.filterStatus}
          value={status}
          allLabel={t.common.all}
          options={(Object.keys(STATUS_KEY) as Array<keyof typeof STATUS_KEY>).map((s) => ({ value: s, label: t.tests[STATUS_KEY[s]] }))}
        />
        <FilterSelect name="subject" label={t.common.subject} value={subject ?? ""} allLabel={t.common.all} options={subjects.map((s) => ({ value: s.id, label: subjectName(s, locale) }))} />
      </FilterBar>
      <Card>
        {error ? (
          <div className="p-5">
            <Notice tone="danger">{t.common.errorGeneric}</Notice>
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<ClipboardList />}
            title={q || status || subject ? t.common.noResults : t.tests.empty}
            action={
              <Button asChild variant="secondary">
                <Link href="/templates">{t.nav.templates}</Link>
              </Button>
            }
          />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <TH>{t.tests.fieldTitle}</TH>
                  <TH>{t.common.subject}</TH>
                  <TH className="text-right">{t.tests.questions}</TH>
                  <TH>{t.common.language}</TH>
                  {!ctx.activeCenterId ? <TH>{t.common.center}</TH> : null}
                  <TH>{t.common.status}</TH>
                  <TH className="text-right">{t.tests.assignTitle}</TH>
                  <TH>{t.common.createdAt}</TH>
                </tr>
              </THead>
              <tbody>
                {rows.map((r) => (
                  <TR key={r.id}>
                    <TD className="font-medium">
                      <Link href={`/tests/${r.id}`} className="hover:text-primary">
                        {r.title}
                      </Link>
                      {r.is_demo ? <Badge tone="accent" className="ml-2">{t.common.demo}</Badge> : null}
                    </TD>
                    <TD>{subjectName(r.subjects, locale)}</TD>
                    <TD className="tabular text-right">{r.question_count}</TD>
                    <TD>{r.language === "kk" ? t.common.kk : t.common.ru}</TD>
                    {!ctx.activeCenterId ? <TD className="text-muted">{r.centers?.code}</TD> : null}
                    <TD>
                      <Badge tone={TEST_STATUS_TONE[r.status]}>{t.tests[STATUS_KEY[r.status]]}</Badge>
                    </TD>
                    <TD className="tabular text-right">{r.test_assignments?.[0]?.count ?? 0}</TD>
                    <TD className="text-muted">{formatDate(r.created_at, locale)}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
            <Pagination t={t} page={page} pageSize={PAGE_SIZE} total={count ?? 0} basePath="/tests" params={{ q: q || undefined, status: status || undefined, subject: subject ?? undefined }} />
          </>
        )}
      </Card>
    </>
  );
}
