import type { Metadata } from "next";
import Link from "next/link";
import { LanguageSwitch } from "@/components/shell/language-switch";
import { AddSubjectForm, ProfileForm, RemoveDemoButton, SubjectToggle } from "@/components/settings/settings-forms";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { requireContext } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { fmt } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { getSubjects } from "@/server/queries";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.settings.title };
}

export default async function SettingsPage() {
  const ctx = await requireContext("settings");
  const { t } = await getI18n();
  const supabase = await createClient();
  const isHq = ctx.role === "hq_admin";
  const retentionDays = Number(process.env.FILE_RETENTION_DAYS ?? 365) || 365;

  const [subjects, demo] = await Promise.all([
    can.manageSubjects(ctx) ? getSubjects(supabase) : Promise.resolve([]),
    isHq
      ? Promise.all(
          (["centers", "students", "tests", "assessment_results"] as const).map((table) =>
            supabase.from(table).select("id", { count: "exact", head: true }).eq("is_demo", true),
          ),
        )
      : Promise.resolve(null),
  ]);
  const demoCounts = demo?.map((r) => r.count ?? 0) ?? [0, 0, 0, 0];
  const demoTotal = demoCounts.reduce((a, b) => a + b, 0);

  return (
    <>
      <PageHeader title={t.settings.title} />
      <div className="grid gap-6 grid-cols-1 xl:grid-cols-2">
        <Card>
          <CardHeader title={t.settings.profile} description={`${t.settings.email}: ${ctx.email}`} />
          <CardBody className="flex flex-col gap-6">
            <ProfileForm fullName={ctx.fullName} />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm font-medium">{t.settings.language}</span>
              <LanguageSwitch />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm font-medium">{t.settings.password}</span>
              <Button asChild variant="secondary">
                <Link href="/auth/set-password">{t.settings.changePassword}</Link>
              </Button>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t.settings.privacy} />
          <CardBody>
            <p className="text-sm leading-relaxed text-ink">{fmt(t.settings.privacyText, { days: retentionDays })}</p>
            <p className="mt-3 text-sm text-muted">{t.students.privacyNote}</p>
          </CardBody>
        </Card>

        {can.manageSubjects(ctx) ? (
          <Card className="xl:col-span-2">
            <CardHeader title={t.settings.subjects} description={t.settings.subjectsHelp} />
            <CardBody className="flex flex-col gap-4">
              <AddSubjectForm />
              <Table>
                <THead>
                  <tr>
                    <TH>{t.settings.subjectCode}</TH>
                    <TH>{t.settings.nameKk}</TH>
                    <TH>{t.settings.nameRu}</TH>
                    <TH>{t.common.status}</TH>
                    <TH className="text-right">{t.common.actions}</TH>
                  </tr>
                </THead>
                <tbody>
                  {subjects.map((s) => (
                    <TR key={s.id}>
                      <TD className="font-mono text-xs">{s.code}</TD>
                      <TD>{s.name_kk}</TD>
                      <TD>{s.name_ru}</TD>
                      <TD>
                        <Badge tone={s.is_active ? "success" : "neutral"}>{s.is_active ? t.common.active : t.common.inactive}</Badge>
                      </TD>
                      <TD className="text-right">
                        <SubjectToggle id={s.id} active={s.is_active} />
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </CardBody>
          </Card>
        ) : null}

        {isHq ? (
          <Card className="xl:col-span-2 border-danger/30">
            <CardHeader title={t.settings.demo} description={t.settings.demoText} />
            <CardBody className="flex flex-wrap items-center justify-between gap-4">
              <p className="text-sm">
                {fmt(t.settings.demoCount, { centers: demoCounts[0]!, students: demoCounts[1]!, tests: demoCounts[2]!, results: demoCounts[3]! })}
              </p>
              <RemoveDemoButton disabled={demoTotal === 0} />
            </CardBody>
          </Card>
        ) : null}
      </div>
    </>
  );
}
