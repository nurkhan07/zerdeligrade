import type { Metadata } from "next";
import { Building2 } from "lucide-react";
import { CenterActiveButton, CenterFormDialog } from "@/components/admin/admin-dialogs";
import { Badge } from "@/components/ui/badge";
import { Card, EmptyState, PageHeader } from "@/components/ui/card";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { requireContext } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { formatDate } from "@/lib/i18n/format";
import { getI18n } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.centers.title };
}

export default async function CentersPage() {
  const ctx = await requireContext("centers");
  const { t, locale } = await getI18n();
  const supabase = await createClient();
  const manage = can.manageCenters(ctx);
  // RLS: HQ sees every center (including inactive ones), center admins only their own.
  const { data } = await supabase
    .from("centers")
    .select("id, name, code, city, address, is_active, is_demo, created_at, students(count), center_memberships(count)")
    .order("name");
  type C = {
    id: string;
    name: string;
    code: string;
    city: string;
    address: string;
    is_active: boolean;
    is_demo: boolean;
    created_at: string;
    students: Array<{ count: number }>;
    center_memberships: Array<{ count: number }>;
  };
  const rows = (data ?? []) as unknown as C[];

  return (
    <>
      <PageHeader title={t.centers.title} subtitle={manage ? t.centers.subtitle : t.centers.myCenter} actions={manage ? <CenterFormDialog /> : null} />
      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={<Building2 />} title={t.centers.empty} />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>{t.centers.name}</TH>
                <TH>{t.centers.code}</TH>
                <TH>{t.centers.city}</TH>
                <TH className="text-right">{t.centers.students}</TH>
                <TH className="text-right">{t.centers.staff}</TH>
                <TH>{t.common.status}</TH>
                <TH>{t.common.createdAt}</TH>
                {manage ? <TH className="text-right">{t.common.actions}</TH> : null}
              </tr>
            </THead>
            <tbody>
              {rows.map((c) => (
                <TR key={c.id}>
                  <TD className="font-medium">
                    {c.name}
                    {c.is_demo ? <Badge tone="accent" className="ml-2">{t.common.demo}</Badge> : null}
                    {c.address ? <p className="text-xs font-normal text-muted">{c.address}</p> : null}
                  </TD>
                  <TD className="font-mono text-sm">{c.code}</TD>
                  <TD>{c.city || "—"}</TD>
                  <TD className="tabular text-right">{c.students?.[0]?.count ?? 0}</TD>
                  <TD className="tabular text-right">{c.center_memberships?.[0]?.count ?? 0}</TD>
                  <TD>
                    <Badge tone={c.is_active ? "success" : "neutral"}>{c.is_active ? t.common.active : t.common.inactive}</Badge>
                  </TD>
                  <TD className="text-muted">{formatDate(c.created_at, locale)}</TD>
                  {manage ? (
                    <TD className="text-right">
                      <div className="flex justify-end gap-1">
                        <CenterFormDialog value={{ id: c.id, name: c.name, code: c.code, city: c.city, address: c.address }} />
                        <CenterActiveButton id={c.id} active={c.is_active} />
                      </div>
                    </TD>
                  ) : null}
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
