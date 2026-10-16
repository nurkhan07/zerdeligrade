import type { Metadata } from "next";
import { UserCog } from "lucide-react";
import { InviteUserDialog, MembershipControls } from "@/components/admin/admin-dialogs";
import { AccessRequests } from "@/components/admin/access-requests";
import { Badge } from "@/components/ui/badge";
import { Card, EmptyState, Notice, PageHeader } from "@/components/ui/card";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { requireContext } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { getI18n } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.users.title };
}

export default async function UsersPage() {
  const ctx = await requireContext("users");
  const { t } = await getI18n();
  const supabase = await createClient();
  const roles = can.assignableRoles(ctx);

  let q = supabase
    .from("center_memberships")
    .select("id, center_id, user_id, role, can_finalize, is_active, profiles!center_memberships_user_id_fkey(full_name, email), centers(name, code)")
    .order("is_active", { ascending: false })
    .order("role");
  if (ctx.activeCenterId) q = q.eq("center_id", ctx.activeCenterId);
  let rq = supabase
    .from("access_requests")
    .select("id, full_name, email, message, created_at, centers(name)")
    .eq("status", "pending")
    .order("created_at");
  if (ctx.activeCenterId) rq = rq.eq("center_id", ctx.activeCenterId);
  const [{ data }, { data: classLinks }, { data: requests }] = await Promise.all([
    q,
    supabase.from("class_teachers").select("user_id, classes(name)"),
    rq,
  ]);
  type Rq = { id: string; full_name: string; email: string; message: string; created_at: string; centers: { name: string } | null };

  type M = {
    id: string;
    center_id: string;
    user_id: string;
    role: "center_admin" | "teacher";
    can_finalize: boolean;
    is_active: boolean;
    profiles: { full_name: string; email: string | null } | null;
    centers: { name: string; code: string } | null;
  };
  const rows = (data ?? []) as unknown as M[];
  const classesByUser = new Map<string, string[]>();
  for (const l of (classLinks ?? []) as unknown as Array<{ user_id: string; classes: { name: string } | null }>) {
    classesByUser.set(l.user_id, [...(classesByUser.get(l.user_id) ?? []), l.classes?.name ?? ""]);
  }
  const inviteCenters = ctx.isHq ? ctx.centers : ctx.centers.filter((c) => ctx.memberships.some((m) => m.center_id === c.id && m.role === "center_admin"));

  return (
    <>
      <PageHeader
        title={t.users.title}
        subtitle={t.users.subtitle}
        actions={<InviteUserDialog roles={roles} centers={inviteCenters.map((c) => ({ id: c.id, name: c.name }))} defaultCenter={ctx.activeCenterId} />}
      />
      <AccessRequests
        rows={((requests ?? []) as unknown as Rq[]).map((r) => ({
          id: r.id,
          fullName: r.full_name,
          email: r.email,
          center: r.centers?.name ?? "",
          message: r.message,
          createdAt: r.created_at,
        }))}
      />
      {ctx.isHq ? (
        <div className="mb-4">
          <Notice>{t.users.hqNote}</Notice>
        </div>
      ) : null}
      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={<UserCog />} title={t.users.empty} />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>{t.users.fullName}</TH>
                <TH>{t.users.email}</TH>
                {!ctx.activeCenterId ? <TH>{t.users.center}</TH> : null}
                <TH>{t.users.role}</TH>
                <TH>{t.users.classes}</TH>
                <TH>{t.common.status}</TH>
                <TH className="text-right">{t.common.actions}</TH>
              </tr>
            </THead>
            <tbody>
              {rows.map((m) => (
                <TR key={m.id} className={m.is_active ? undefined : "opacity-60"}>
                  <TD className="font-medium">{m.profiles?.full_name || t.common.unknownUser}</TD>
                  <TD className="text-muted">{m.profiles?.email}</TD>
                  {!ctx.activeCenterId ? <TD className="text-muted">{m.centers?.code}</TD> : null}
                  <TD>
                    <Badge tone={m.role === "center_admin" ? "brand" : "info"}>{t.roles[m.role]}</Badge>
                  </TD>
                  <TD className="max-w-48 truncate text-sm text-muted">{(classesByUser.get(m.user_id) ?? []).join(", ") || "—"}</TD>
                  <TD>
                    <Badge tone={m.is_active ? "success" : "neutral"}>{m.is_active ? t.common.active : t.common.inactive}</Badge>
                  </TD>
                  <TD className="text-right">
                    <MembershipControls id={m.id} role={m.role} active={m.is_active} canFinalize={m.can_finalize} roles={roles} self={m.user_id === ctx.userId} />
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
