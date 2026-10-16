import { NextResponse, type NextRequest } from "next/server";
import { audit } from "@/lib/audit";
import { getAppContext } from "@/lib/auth/context";
import { csvResponseHeaders, toCsv } from "@/lib/csv/write";
import { logError } from "@/lib/errors";
import { getI18n } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/utils";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const ctx = await getAppContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { t } = await getI18n();
  const sp = request.nextUrl.searchParams;
  const classId = sp.get("class");
  const status = sp.get("status");
  const supabase = await createClient();

  let q = supabase
    .from("students")
    .select("last_name, first_name, student_code, status, classes(name), centers(code)")
    .order("last_name")
    .order("first_name")
    .limit(50000);
  if (ctx.activeCenterId) q = q.eq("center_id", ctx.activeCenterId);
  if (isUuid(classId)) q = q.eq("class_id", classId);
  if (status && ["active", "inactive", "graduated"].includes(status)) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) {
    logError("export.students", error);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
  type S = { last_name: string; first_name: string; student_code: string | null; status: string; classes: { name: string } | null; centers: { code: string } | null };
  const rows = ((data ?? []) as unknown as S[]).map((s) => [
    s.last_name,
    s.first_name,
    s.student_code ?? "",
    s.classes?.name ?? "",
    s.centers?.code ?? "",
    t.students[`status_${s.status}` as "status_active"] ?? s.status,
  ]);
  // Header names match the CSV import aliases, so an export can be re-imported.
  const header = [t.students.lastName, t.students.firstName, t.students.code, t.students.class, t.common.center, t.common.status];
  await audit({ actorId: ctx.userId, centerId: ctx.activeCenterId, action: "export.students", entityType: "export", details: { rows: rows.length } });
  return new NextResponse(toCsv(header, rows), { headers: csvResponseHeaders(`zerdeligrade-students-${new Date().toISOString().slice(0, 10)}.csv`) });
}
