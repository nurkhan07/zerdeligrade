import { redirect } from "next/navigation";
import { AccessRequestForm } from "@/components/auth/access-request-form";
import { AuthCard } from "@/components/auth/auth-card";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/card";
import { fmt } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { signOutAction } from "@/server/actions/preferences";

/** Signed-in user without a center: shows the access request form or its status. */
export default async function NoAccessPage() {
  const { t } = await getI18n();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: memberships }, { data: requests }, { data: centers }, { data: profile }] = await Promise.all([
    supabase.from("center_memberships").select("center_id").eq("user_id", user.id).eq("is_active", true).limit(1),
    supabase.from("access_requests").select("status, decision_comment, center_id").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1),
    supabase.rpc("list_signup_centers"),
    supabase.from("profiles").select("full_name, is_hq_admin").eq("id", user.id).maybeSingle(),
  ]);
  if (memberships?.length || profile?.is_hq_admin) redirect("/dashboard");

  type R = { status: string; decision_comment: string; center_id: string };
  const last = (requests ?? [])[0] as unknown as R | undefined;
  const centerList = (centers ?? []) as Array<{ id: string; name: string; city: string }>;
  // RLS hides centers from people who are not members yet, so the name comes
  // from the public signup list instead of a join.
  const centerName = centerList.find((c) => c.id === last?.center_id)?.name ?? "—";

  return (
    <AuthCard title={t.auth.noAccessTitle} subtitle={user.email}>
      <div className="flex flex-col gap-5">
        {last?.status === "pending" ? (
          <Notice>{fmt(t.access.pending, { center: centerName })}</Notice>
        ) : (
          <>
            {last?.status === "rejected" ? (
              <Notice tone="danger">{fmt(t.access.rejected, { center: centerName, reason: last.decision_comment })}</Notice>
            ) : null}
            {centerList.length ? (
              <AccessRequestForm centers={centerList} fullName={profile?.full_name ?? ""} />
            ) : (
              <Notice tone="warning">{t.access.noCenters}</Notice>
            )}
          </>
        )}
        <form action={signOutAction}>
          <Button type="submit" variant="secondary" className="w-full">
            {t.nav.signOut}
          </Button>
        </form>
      </div>
    </AuthCard>
  );
}
