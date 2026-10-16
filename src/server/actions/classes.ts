"use server";
import { ActionFailure, failOnDbError, requireActiveCenter, runAction, type ActionResult } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { can } from "@/lib/auth/permissions";
import { isUuid } from "@/lib/utils";
import { classSchema, fieldErrors, type ClassInput } from "@/lib/validation/schemas";

export async function saveClassAction(input: ClassInput): Promise<ActionResult<{ id: string }>> {
  return runAction("classes.save", "classes", async (env) => {
    const { app, t, supabase } = env;
    if (!can.manageClasses(app)) throw new ActionFailure(t.common.forbidden);
    const parsed = classSchema.safeParse(input);
    if (!parsed.success) throw new ActionFailure(t.errors.validation, fieldErrors(parsed.error));
    const { id, ...data } = parsed.data;
    if (id) {
      const { data: row, error } = await supabase.from("classes").update(data).eq("id", id).select("center_id").maybeSingle();
      if (error) {
        if (error.code === "23505") throw new ActionFailure(t.classes.duplicate, { name: "duplicate" });
        failOnDbError(error, t, "classes.update");
      }
      if (!row) throw new ActionFailure(t.common.notFound);
      await audit({ actorId: app.userId, centerId: row.center_id, action: "class.updated", entityType: "class", entityId: id });
      return { ok: true, message: t.common.saved, data: { id } };
    }
    const centerId = requireActiveCenter(env);
    const { data: row, error } = await supabase.from("classes").insert({ ...data, center_id: centerId }).select("id").single();
    if (error) {
      if (error.code === "23505") throw new ActionFailure(t.classes.duplicate, { name: "duplicate" });
      failOnDbError(error, t, "classes.insert");
    }
    await audit({ actorId: app.userId, centerId, action: "class.created", entityType: "class", entityId: row.id });
    return { ok: true, message: t.common.created, data: { id: row.id } };
  });
}

export async function deleteClassAction(id: string): Promise<ActionResult> {
  return runAction("classes.delete", "classes", async ({ app, t, supabase }) => {
    if (!can.manageClasses(app) || !isUuid(id)) throw new ActionFailure(t.common.forbidden);
    const { data: row, error } = await supabase.from("classes").delete().eq("id", id).select("center_id").maybeSingle();
    if (error) failOnDbError(error, t, "classes.delete");
    if (!row) throw new ActionFailure(t.common.notFound);
    await audit({ actorId: app.userId, centerId: row.center_id, action: "class.deleted", entityType: "class", entityId: id });
    return { ok: true, message: t.common.deleted };
  });
}

export async function assignTeacherAction(classId: string, userId: string): Promise<ActionResult> {
  return runAction("classes.assign_teacher", "classes", async ({ app, t, supabase }) => {
    if (!can.manageClasses(app) || !isUuid(classId) || !isUuid(userId)) throw new ActionFailure(t.common.forbidden);
    const { data: cls } = await supabase.from("classes").select("center_id").eq("id", classId).maybeSingle();
    if (!cls) throw new ActionFailure(t.common.notFound);
    const { error } = await supabase.from("class_teachers").insert({ class_id: classId, center_id: cls.center_id, user_id: userId });
    if (error && error.code !== "23505") failOnDbError(error, t, "classes.assign_teacher");
    await audit({ actorId: app.userId, centerId: cls.center_id, action: "class.updated", entityType: "class", entityId: classId, details: { teacher_added: userId } });
    return { ok: true, message: t.common.saved };
  });
}

export async function removeTeacherAction(classId: string, userId: string): Promise<ActionResult> {
  return runAction("classes.remove_teacher", "classes", async ({ app, t, supabase }) => {
    if (!can.manageClasses(app) || !isUuid(classId) || !isUuid(userId)) throw new ActionFailure(t.common.forbidden);
    const { data: row, error } = await supabase
      .from("class_teachers")
      .delete()
      .eq("class_id", classId)
      .eq("user_id", userId)
      .select("center_id")
      .maybeSingle();
    if (error) failOnDbError(error, t, "classes.remove_teacher");
    if (!row) throw new ActionFailure(t.common.notFound);
    await audit({ actorId: app.userId, centerId: row.center_id, action: "class.updated", entityType: "class", entityId: classId, details: { teacher_removed: userId } });
    return { ok: true, message: t.common.saved };
  });
}
