"use server";
import { ActionFailure, failOnDbError, requireActiveCenter, runAction, type ActionResult } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { can } from "@/lib/auth/permissions";
import { buildImportPreview, MAX_IMPORT_ROWS } from "@/lib/csv/students";
import { fmt } from "@/lib/i18n/config";
import type { ServerSupabase } from "@/lib/supabase/server";
import { fieldErrors, studentSchema, type StudentInput } from "@/lib/validation/schemas";

export async function saveStudentAction(input: StudentInput): Promise<ActionResult<{ id: string }>> {
  return runAction("students.save", "students", async (env) => {
    const { app, t, supabase } = env;
    if (!can.manageStudents(app)) throw new ActionFailure(t.common.forbidden);
    const parsed = studentSchema.safeParse(input);
    if (!parsed.success) throw new ActionFailure(t.errors.validation, fieldErrors(parsed.error));
    const { id, ...data } = parsed.data;

    if (id) {
      const { data: row, error } = await supabase.from("students").update(data).eq("id", id).select("id, center_id").maybeSingle();
      if (error) {
        if (error.code === "23505") throw new ActionFailure(t.students.duplicateCode, { student_code: "duplicateCode" });
        failOnDbError(error, t, "students.update");
      }
      if (!row) throw new ActionFailure(t.common.notFound);
      await audit({ actorId: app.userId, centerId: row.center_id, action: "student.updated", entityType: "student", entityId: id });
      return { ok: true, message: t.common.saved, data: { id } };
    }

    const centerId = requireActiveCenter(env);
    const { data: row, error } = await supabase
      .from("students")
      .insert({ ...data, center_id: centerId })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") throw new ActionFailure(t.students.duplicateCode, { student_code: "duplicateCode" });
      failOnDbError(error, t, "students.insert");
    }
    await audit({ actorId: app.userId, centerId, action: "student.created", entityType: "student", entityId: row.id });
    return { ok: true, message: t.common.created, data: { id: row.id } };
  });
}

export async function setStudentStatusAction(id: string, status: "active" | "inactive" | "graduated"): Promise<ActionResult> {
  return runAction("students.status", "students", async ({ app, t, supabase }) => {
    if (!can.manageStudents(app)) throw new ActionFailure(t.common.forbidden);
    if (!["active", "inactive", "graduated"].includes(status)) throw new ActionFailure(t.errors.validation);
    const { data: row, error } = await supabase.from("students").update({ status }).eq("id", id).select("center_id").maybeSingle();
    if (error) failOnDbError(error, t, "students.status");
    if (!row) throw new ActionFailure(t.common.notFound);
    await audit({ actorId: app.userId, centerId: row.center_id, action: "student.updated", entityType: "student", entityId: id, details: { status } });
    return { ok: true, message: t.common.saved };
  });
}

/** Loads the duplicate-detection context for the active center. */
async function importContext(supabase: ServerSupabase, centerId: string) {
  const [{ data: students }, { data: classes }] = await Promise.all([
    supabase.from("students").select("first_name, last_name, student_code").eq("center_id", centerId).limit(50000),
    supabase.from("classes").select("id, name").eq("center_id", centerId),
  ]);
  return {
    existingCodes: new Set((students ?? []).filter((s) => s.student_code).map((s) => String(s.student_code).toLowerCase())),
    existingNames: new Set((students ?? []).map((s) => `${s.last_name}|${s.first_name}`.toLowerCase())),
    classesByName: new Map((classes ?? []).map((c) => [String(c.name).toLowerCase(), String(c.id)])),
  };
}

/** Returns the server-side preview (same validation the import will apply). */
export async function previewStudentImportAction(csv: string) {
  return runAction("students.import_preview", "students", async (env) => {
    const { app, t, supabase } = env;
    if (!can.manageStudents(app)) throw new ActionFailure(t.common.forbidden);
    if (csv.length > 2_000_000) throw new ActionFailure(t.students.importTooMany);
    const centerId = requireActiveCenter(env);
    const preview = buildImportPreview(csv, await importContext(supabase, centerId));
    return { ok: true, data: preview };
  });
}

export async function importStudentsAction(csv: string): Promise<ActionResult<{ imported: number }>> {
  return runAction("students.import", "students", async (env) => {
    const { app, t, supabase } = env;
    if (!can.manageStudents(app)) throw new ActionFailure(t.common.forbidden);
    if (csv.length > 2_000_000) throw new ActionFailure(t.students.importTooMany);
    const centerId = requireActiveCenter(env);
    // Re-validate on the server: never trust the browser preview.
    const preview = buildImportPreview(csv, await importContext(supabase, centerId));
    if (preview.missingColumns.length) throw new ActionFailure(t.students.importMissingColumns);
    const rows = preview.rows
      .filter((r) => r.errors.length === 0 && r.data)
      .slice(0, MAX_IMPORT_ROWS)
      .map((r) => ({
        center_id: centerId,
        first_name: r.data!.first_name,
        last_name: r.data!.last_name,
        student_code: r.data!.student_code,
        class_id: r.classId,
      }));
    let imported = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error } = await supabase.from("students").insert(chunk);
      if (error) failOnDbError(error, t, "students.import");
      imported += chunk.length;
    }
    await audit({ actorId: app.userId, centerId, action: "student.imported", entityType: "student", details: { imported, skipped: preview.rows.length - imported } });
    return { ok: true, message: fmt(t.students.imported, { count: imported }), data: { imported } };
  });
}
