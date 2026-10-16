import type { Metadata } from "next";
import { TestMetaForm } from "@/components/tests/test-meta-form";
import { Card, CardBody, Notice, PageHeader } from "@/components/ui/card";
import { requireContext } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { getI18n } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { getSubjects, subjectName } from "@/server/queries";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.tests.new };
}

export default async function NewTestPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireContext("tests");
  const { t, locale } = await getI18n();
  const sp = await searchParams;
  const supabase = await createClient();
  const subjects = (await getSubjects(supabase)).filter((s) => s.is_active);
  const canCreate = can.createTests(ctx);
  return (
    <>
      <PageHeader title={sp.template === "hq" ? t.templates.newHq : t.tests.new} />
      <Card className="max-w-3xl">
        <CardBody>
          {canCreate ? (
            <TestMetaForm
              subjects={subjects.map((s) => ({ id: s.id, name: subjectName(s, locale) }))}
              canHq={can.manageHqTemplates(ctx)}
              hasCenter={ctx.activeCenterId !== null}
            />
          ) : (
            <Notice>{t.centerSwitch.required}</Notice>
          )}
        </CardBody>
      </Card>
    </>
  );
}
