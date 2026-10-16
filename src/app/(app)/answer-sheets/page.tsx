import type { Metadata } from "next";
import { FileDown, KeyRound, Printer } from "lucide-react";
import { SheetGenerator } from "@/components/sheets/sheet-generator";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState, Notice, PageHeader } from "@/components/ui/card";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { requireContext } from "@/lib/auth/context";
import { formatDateTime } from "@/lib/i18n/format";
import { getI18n } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { str } from "@/lib/utils";
import { getClasses } from "@/server/queries";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.sheets.title };
}

export default async function AnswerSheetsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext("answerSheets");
  const { t, locale } = await getI18n();
  const supabase = await createClient();
  const sp = await searchParams;
  const center = ctx.activeCenterId;

  if (!center) {
    return (
      <>
        <PageHeader title={t.sheets.title} subtitle={t.sheets.subtitle} />
        <Notice>{t.centerSwitch.required}</Notice>
      </>
    );
  }

  const [{ data: tests }, classes, { data: students }, { data: recent }] = await Promise.all([
    supabase
      .from("tests")
      .select("id, title, language, question_count")
      .eq("center_id", center)
      .eq("status", "published")
      .eq("is_template", false)
      .order("published_at", { ascending: false })
      .limit(300),
    getClasses(supabase, center),
    supabase.from("students").select("id, first_name, last_name, class_id").eq("center_id", center).eq("status", "active").order("last_name").limit(5000),
    supabase
      .from("answer_sheets")
      .select("batch_id, created_at, test_id, tests(title), classes(name)")
      .eq("center_id", center)
      .order("created_at", { ascending: false })
      .limit(400),
  ]);

  type B = { batch_id: string; created_at: string; test_id: string; tests: { title: string } | null; classes: { name: string } | null };
  const batches = new Map<string, B & { n: number }>();
  for (const s of (recent ?? []) as unknown as B[]) {
    const b = batches.get(s.batch_id);
    if (b) b.n++;
    else batches.set(s.batch_id, { ...s, n: 1 });
  }

  return (
    <>
      <PageHeader title={t.sheets.title} subtitle={t.sheets.subtitle} />
      <div className="grid gap-6 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title={t.sheets.generate} description={t.sheets.printTips} />
          <CardBody>
            <SheetGenerator
              initialTest={str(sp.test)}
              tests={(tests ?? []) as Array<{ id: string; title: string; language: "kk" | "ru"; question_count: number }>}
              classes={classes.filter((c) => c.is_active).map((c) => ({ id: c.id, name: c.name }))}
              students={(students ?? []).map((s) => ({ id: s.id, name: `${s.last_name} ${s.first_name}`, class_id: s.class_id }))}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t.sheets.recentBatches} />
          {batches.size === 0 ? (
            <EmptyState icon={<Printer />} title={t.sheets.empty} />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>{t.common.date}</TH>
                  <TH>{t.common.test}</TH>
                  <TH className="text-right">{t.sheets.sheetsCount}</TH>
                  <TH className="text-right">{t.common.actions}</TH>
                </tr>
              </THead>
              <tbody>
                {[...batches.values()].slice(0, 20).map((b) => (
                  <TR key={b.batch_id}>
                    <TD className="whitespace-nowrap text-muted">{formatDateTime(b.created_at, locale)}</TD>
                    <TD>
                      <span className="font-medium">{b.tests?.title}</span>
                      {b.classes?.name ? <span className="text-muted"> · {b.classes.name}</span> : null}
                    </TD>
                    <TD className="tabular text-right">{b.n}</TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button asChild variant="ghost" size="icon" title={t.sheets.printBatch}>
                          <a href={`/print/answer-sheets?batch=${b.batch_id}`} target="_blank" rel="noopener" aria-label={t.sheets.printBatch}>
                            <Printer />
                          </a>
                        </Button>
                        <Button asChild variant="ghost" size="icon" title={t.sheets.downloadPdf}>
                          <a href={`/api/answer-sheets/pdf?batch=${b.batch_id}`} aria-label={t.sheets.downloadPdf}>
                            <FileDown />
                          </a>
                        </Button>
                        <Button asChild variant="ghost" size="icon" title={t.sheets.answerKey}>
                          <a href={`/print/answer-key/${b.test_id}`} target="_blank" rel="noopener" aria-label={t.sheets.answerKey}>
                            <KeyRound />
                          </a>
                        </Button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
