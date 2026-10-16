"use server";
import { z } from "zod";
import { ActionFailure, failOnDbError, runAction, type ActionResult, type ActionEnv } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { can } from "@/lib/auth/permissions";
import { requirePublicEnv } from "@/lib/env";
import { logError } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { centerSchema, fieldErrors, inviteSchema, subjectSchema, type CenterInput, type InviteInput } from "@/lib/validation/schemas";

// ----------------------------------------------------------------- centers

export async function saveCenterAction(input: CenterInput): Promise<ActionResult<{ id: string }>> {
  return runAction("centers.save", "centers", async ({ app, t, supabase }) => {
    if (!can.manageCenters(app)) throw new ActionFailure(t.common.forbidden);
    const parsed = centerSchema.safeParse(input);
    if (!parsed.success) throw new ActionFailure(t.errors.validation, fieldErrors(parsed.error));
    const { id, ...data } = parsed.data;
    const q = id ? supabase.from("centers").update(data).eq("id", id) : supabase.from("centers").insert(data);
    const { data: row, error } = await q.select("id").maybeSingle();
    if (error) {
      if (error.code === "23505") throw new ActionFailure(t.centers.duplicateCode, { code: "duplicate" });
      failOnDbError(error, t, "centers.save");
    }
    if (!row) throw new ActionFailure(t.common.notFound);
    await audit({ actorId: app.userId, centerId: row.id, action: id ? "center.updated" : "center.created", entityType: "center", entityId: row.id, details: { code: data.code } });
    return { ok: true, message: id ? t.common.saved : t.common.created, data: { id: row.id } };
  });
}

export async function setCenterActiveAction(id: string, active: boolean): Promise<ActionResult> {
  return runAction("centers.active", "centers", async ({ app, t, supabase }) => {
    if (!can.manageCenters(app) || !z.string().uuid().safeParse(id).success) throw new ActionFailure(t.common.forbidden);
    const { data: row, error } = await supabase.from("centers").update({ is_active: active }).eq("id", id).select("id").maybeSingle();
    if (error) failOnDbError(error, t, "centers.active");
    if (!row) throw new ActionFailure(t.common.notFound);
    await audit({ actorId: app.userId, centerId: id, action: "center.updated", entityType: "center", entityId: id, details: { is_active: active } });
    return { ok: true, message: t.common.saved };
  });
}

// ------------------------------------------------------------------- staff

/** Server-side authorization for staff management in a given center. */
function assertCanManageCenterStaff(env: ActionEnv, centerId: string, role: "center_admin" | "teacher") {
  const { app, t } = env;
  if (!can.assignableRoles(app).includes(role)) throw new ActionFailure(t.common.forbidden);
  if (app.role === "hq_admin") return;
  const m = app.memberships.find((x) => x.center_id === centerId);
  if (!m || m.role !== "center_admin") throw new ActionFailure(t.common.forbidden);
}

export async function inviteUserAction(input: InviteInput): Promise<ActionResult> {
  return runAction("users.invite", "users", async (env) => {
    const { app, t, locale } = env;
    const parsed = inviteSchema.safeParse(input);
    if (!parsed.success) throw new ActionFailure(t.errors.validation, fieldErrors(parsed.error));
    const p = parsed.data;
    assertCanManageCenterStaff(env, p.center_id, p.role);

    const admin = createAdminClient();
    // Exact match (p.email is lower-cased by the schema). Never use ILIKE here:
    // "_" and "%" are wildcards and could match someone else's account.
    const { data: existing } = await admin.from("profiles").select("id").eq("email", p.email).maybeSingle();
    let userId = existing?.id as string | undefined;
    let invited = false;
    if (!userId) {
      const { siteUrl } = requirePublicEnv();
      const { data, error } = await admin.auth.admin.inviteUserByEmail(p.email, {
        data: { full_name: p.full_name, preferred_locale: locale },
        redirectTo: `${siteUrl}/auth/confirm?next=/auth/set-password`,
      });
      if (error || !data.user) {
        logError("users.invite", error);
        throw new ActionFailure(error?.status === 429 ? t.auth.rateLimited : t.common.errorGeneric);
      }
      userId = data.user.id;
      invited = true;
    }
    if (userId === app.userId) throw new ActionFailure(t.users.cannotChangeSelf);

    const { data: membership } = await admin.from("center_memberships").select("id, is_active").eq("center_id", p.center_id).eq("user_id", userId).maybeSingle();
    if (membership?.is_active) throw new ActionFailure(t.users.alreadyMember);
    const { error } = membership
      ? await admin.from("center_memberships").update({ is_active: true, role: p.role, can_finalize: p.can_finalize }).eq("id", membership.id)
      : await admin
          .from("center_memberships")
          .insert({ center_id: p.center_id, user_id: userId, role: p.role, can_finalize: p.can_finalize, created_by: app.userId });
    if (error) failOnDbError(error, t, "users.membership");
    await audit({ actorId: app.userId, centerId: p.center_id, action: "user.invited", entityType: "user", entityId: userId, details: { role: p.role, invited } });
    return { ok: true, message: invited ? t.users.invited : t.users.added };
  });
}

export async function updateMembershipAction(
  membershipId: string,
  patch: { role?: "center_admin" | "teacher"; is_active?: boolean; can_finalize?: boolean },
): Promise<ActionResult> {
  return runAction("users.membership_update", "users", async (env) => {
    const { app, t } = env;
    if (!z.string().uuid().safeParse(membershipId).success) throw new ActionFailure(t.common.notFound);
    const clean = z
      .object({ role: z.enum(["center_admin", "teacher"]).optional(), is_active: z.boolean().optional(), can_finalize: z.boolean().optional() })
      .strict()
      .safeParse(patch);
    if (!clean.success) throw new ActionFailure(t.errors.validation);

    // Read through RLS first: proves the caller may see this membership at all.
    const { data: m } = await env.supabase.from("center_memberships").select("id, center_id, user_id, role").eq("id", membershipId).maybeSingle();
    if (!m) throw new ActionFailure(t.common.notFound);
    if (m.user_id === app.userId) throw new ActionFailure(t.users.cannotChangeSelf);
    assertCanManageCenterStaff(env, m.center_id, m.role as "center_admin" | "teacher");
    if (clean.data.role) assertCanManageCenterStaff(env, m.center_id, clean.data.role);

    const admin = createAdminClient();
    const { error } = await admin.from("center_memberships").update(clean.data).eq("id", membershipId);
    if (error) failOnDbError(error, t, "users.membership_update");
    await audit({ actorId: app.userId, centerId: m.center_id, action: "membership.updated", entityType: "user", entityId: m.user_id, details: clean.data });
    return {
      ok: true,
      message: clean.data.is_active === false ? t.users.accessRevoked : clean.data.is_active === true ? t.users.accessRestored : t.common.saved,
    };
  });
}

// ---------------------------------------------------------------- settings

export async function updateProfileAction(fullName: string): Promise<ActionResult> {
  return runAction("profile.update", undefined, async ({ app, t, supabase }) => {
    const name = z.string().trim().min(2).max(200).safeParse(fullName);
    if (!name.success) throw new ActionFailure(t.validation.tooShort);
    const { error } = await supabase.from("profiles").update({ full_name: name.data }).eq("id", app.userId);
    if (error) failOnDbError(error, t, "profile.update");
    return { ok: true, message: t.common.saved };
  });
}

export async function createSubjectAction(input: z.input<typeof subjectSchema>): Promise<ActionResult> {
  return runAction("subjects.create", "settings", async ({ app, t, supabase }) => {
    if (!can.manageSubjects(app)) throw new ActionFailure(t.common.forbidden);
    const parsed = subjectSchema.safeParse(input);
    if (!parsed.success) throw new ActionFailure(t.errors.validation, fieldErrors(parsed.error));
    const { error } = await supabase.from("subjects").insert(parsed.data);
    if (error) failOnDbError(error, t, "subjects.create");
    await audit({ actorId: app.userId, centerId: null, action: "subject.created", entityType: "subject", entityId: parsed.data.code });
    return { ok: true, message: t.common.created };
  });
}

export async function setSubjectActiveAction(id: string, active: boolean): Promise<ActionResult> {
  return runAction("subjects.active", "settings", async ({ app, t, supabase }) => {
    if (!can.manageSubjects(app) || !z.string().uuid().safeParse(id).success) throw new ActionFailure(t.common.forbidden);
    const { error } = await supabase.from("subjects").update({ is_active: active }).eq("id", id);
    if (error) failOnDbError(error, t, "subjects.active");
    return { ok: true, message: t.common.saved };
  });
}

/** Deletes every record flagged as demo data (HQ only). */
export async function removeDemoDataAction(): Promise<ActionResult> {
  return runAction("demo.remove", "settings", async ({ app, t }) => {
    if (app.role !== "hq_admin") throw new ActionFailure(t.common.forbidden);
    const admin = createAdminClient();
    const { data: demoCenters } = await admin.from("centers").select("id").eq("is_demo", true);
    const { data: demoUsers } = await admin.from("profiles").select("id").eq("is_demo", true);
    // Deleting a center cascades to its classes, students, tests, sheets, scans and results.
    const ids = (demoCenters ?? []).map((c) => c.id);
    if (ids.length) {
      const { data: files } = await admin.from("file_metadata").select("bucket, object_path").in("center_id", ids);
      for (const f of files ?? []) await admin.storage.from(f.bucket).remove([f.object_path]);
      const { error } = await admin.from("centers").delete().in("id", ids);
      if (error) failOnDbError(error, t, "demo.remove.centers");
    }
    for (const u of demoUsers ?? []) await admin.auth.admin.deleteUser(u.id);
    for (const table of ["students", "classes", "tests", "assessment_results"] as const) {
      await admin.from(table).delete().eq("is_demo", true);
    }
    await audit({ actorId: app.userId, centerId: null, action: "demo.removed", entityType: "demo", details: { centers: ids.length, users: demoUsers?.length ?? 0 } });
    return { ok: true, message: t.settings.demoRemoved };
  });
}
