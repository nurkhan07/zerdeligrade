import type { Metadata } from "next";
import Link from "next/link";
import { Copy, Plus } from "lucide-react";
import { UseTemplateButton } from "@/components/tests/use-template-button";
import { Badge, TEST_STATUS_TONE } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, EmptyState, Notice, PageHeader } from "@/components/ui/card";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { requireContext } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import type { Dictionary, Locale } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { subjectName } from "@/server/queries";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.templates.title };
}

const STATUS_KEY = { draft: "statusDraft", published: "statusPublished", archived: "statusArchived" } as const;
type Row = {
  id: string;
  title: string;
  status: keyof typeof STATUS_KEY;
  question_count: number;
  language: "kk" | "ru";
  subjects: { name_kk: string; name_ru: string } | null;
};

function TemplateTable({ rows, t, locale, canUse }: { rows: Row[]; t: Dictionary; locale: Locale; canUse: boolean }) {
  if (!rows.length) return <EmptyState icon={<Copy />} title={t.templates.empty} />;
  return (
    <Table>
      <THead>
        <tr>
          <TH>{t.tests.fieldTitle}</TH>
          <TH>{t.common.subject}</TH>
          <TH className="text-right">{t.tests.questions}</TH>
          <TH>{t.common.language}</TH>
          <TH>{t.common.status}</TH>
          <TH className="text-right">{t.common.actions}</TH>
        </tr>
      </THead>
      <tbody>
        {rows.map((r) => (
          <TR key={r.id}>
            <TD className="font-medium">
              <Link href={`/tests/${r.id}`} className="hover:text-primary">
                {r.title}
              </Link>
            </TD>
            <TD>{subjectName(r.subjects, locale)}</TD>
            <TD className="tabular text-right">{r.question_count}</TD>
            <TD>{r.language === "kk" ? t.common.kk : t.common.ru}</TD>
            <TD>
              <Badge tone={TEST_STATUS_TONE[r.status]}>{t.tests[STATUS_KEY[r.status]]}</Badge>
            </TD>
            <TD className="text-right">
              <UseTemplateButton testId={r.id} disabled={!canUse} />
            </TD>
          </TR>
        ))}
      </tbody>
    </Table>
  );
}

export default async function TemplatesPage() {
  const ctx = await requireContext("templates");
  const { t, locale } = await getI18n();
  const supabase = await createClient();
  const select = "id, title, status, question_count, language, subjects(name_kk, name_ru)";
  const hqQuery = supabase.from("tests").select(select).is("center_id", null).eq("is_template", true).order("title");
  const centerQuery = ctx.activeCenterId
    ? supabase.from("tests").select(select).eq("center_id", ctx.activeCenterId).eq("is_template", true).order("title")
    : null;
  const [hq, center] = await Promise.all([hqQuery, centerQuery ?? Promise.resolve({ data: [] })]);
  const canUse = ctx.activeCenterId !== null;

  return (
    <>
      <PageHeader
        title={t.templates.title}
        subtitle={t.templates.subtitle}
        actions={
          can.manageHqTemplates(ctx) ? (
            <Button asChild>
              <Link href="/tests/new?template=hq">
                <Plus /> {t.templates.newHq}
              </Link>
            </Button>
          ) : null
        }
      />
      {!canUse ? (
        <div className="mb-4">
          <Notice>{t.centerSwitch.required}</Notice>
        </div>
      ) : null}
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader title={t.templates.hq} />
          <TemplateTable rows={(hq.data ?? []) as unknown as Row[]} t={t} locale={locale} canUse={canUse} />
        </Card>
        {ctx.activeCenterId ? (
          <Card>
            <CardHeader title={t.templates.center} />
            <TemplateTable rows={(center.data ?? []) as unknown as Row[]} t={t} locale={locale} canUse={canUse} />
          </Card>
        ) : null}
      </div>
    </>
  );
}
