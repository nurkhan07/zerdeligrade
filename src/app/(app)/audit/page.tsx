import type { Metadata } from "next";
import { ScrollText } from "lucide-react";
import { FilterBar, FilterInput, FilterSelect } from "@/components/filters";
import { Card, EmptyState, PageHeader } from "@/components/ui/card";
import { Pagination } from "@/components/ui/pagination";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { requireContext } from "@/lib/auth/context";
import { formatDateTime } from "@/lib/i18n/format";
import { getI18n } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { pageParam, str } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.audit.title };
}

const PAGE_SIZE = 50;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext("audit");
  const { t, locale } = await getI18n();
  const supabase = await createClient();
  const sp = await searchParams;
  const actions = Object.keys(t.auditActions);
  const action = actions.includes(str(sp.action)) ? str(sp.action) : "";
  const from = DATE_RE.test(str(sp.from)) ? str(sp.from) : "";
  const to = DATE_RE.test(str(sp.to)) ? str(sp.to) : "";
  const page = pageParam(sp.page);

  let q = supabase
    .from("audit_logs")
    .select("id, action, entity_type, entity_id, details, created_at, profiles(full_name, email), centers(code)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (ctx.activeCenterId) q = q.eq("center_id", ctx.activeCenterId);
  if (action) q = q.eq("action", action);
  if (from) q = q.gte("created_at", `${from}T00:00:00+05:00`);
  if (to) q = q.lte("created_at", `${to}T23:59:59+05:00`);
  const { data, count } = await q;

  type L = {
    id: number;
    action: string;
    entity_type: string;
    entity_id: string | null;
    details: Record<string, unknown>;
    created_at: string;
    profiles: { full_name: string; email: string | null } | null;
    centers: { code: string } | null;
  };
  const rows = (data ?? []) as unknown as L[];
  const label = (a: string) => (t.auditActions as Record<string, string>)[a] ?? a;

  return (
    <>
      <PageHeader title={t.audit.title} subtitle={t.audit.subtitle} />
      <FilterBar t={t} resetHref="/audit">
        <FilterSelect name="action" label={t.audit.action} value={action} allLabel={t.common.all} options={actions.map((a) => ({ value: a, label: label(a) }))} />
        <FilterInput name="from" type="date" label={t.common.from} value={from} />
        <FilterInput name="to" type="date" label={t.common.to} value={to} />
      </FilterBar>
      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={<ScrollText />} title={t.audit.empty} />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <TH>{t.audit.time}</TH>
                  <TH>{t.audit.actor}</TH>
                  <TH>{t.audit.action}</TH>
                  {!ctx.activeCenterId ? <TH>{t.common.center}</TH> : null}
                  <TH>{t.audit.entity}</TH>
                  <TH>{t.audit.details}</TH>
                </tr>
              </THead>
              <tbody>
                {rows.map((r) => (
                  <TR key={r.id}>
                    <TD className="whitespace-nowrap text-muted">{formatDateTime(r.created_at, locale)}</TD>
                    <TD>{r.profiles?.full_name || r.profiles?.email || t.audit.system}</TD>
                    <TD className="font-medium">{label(r.action)}</TD>
                    {!ctx.activeCenterId ? <TD className="text-muted">{r.centers?.code ?? "—"}</TD> : null}
                    <TD className="font-mono text-xs text-muted">
                      {r.entity_type}
                      {r.entity_id ? `:${r.entity_id.slice(0, 8)}` : ""}
                    </TD>
                    <TD className="max-w-80 truncate font-mono text-xs text-muted" title={JSON.stringify(r.details)}>
                      {Object.keys(r.details ?? {}).length ? JSON.stringify(r.details) : "—"}
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
            <Pagination t={t} page={page} pageSize={PAGE_SIZE} total={count ?? 0} basePath="/audit" params={{ action: action || undefined, from: from || undefined, to: to || undefined }} />
          </>
        )}
      </Card>
    </>
  );
}
