import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { logError } from "@/lib/errors";
import { getServerEnv } from "@/lib/server-env";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteStoredFile } from "@/server/files";

export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(request: NextRequest, secret: string | null): boolean {
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Retention job (Vercel Cron, daily): deletes answer-sheet photos whose
 * retention period has passed. Results and the audit trail are kept; the
 * file_metadata row is marked deleted.
 */
export async function GET(request: NextRequest) {
  let env;
  try {
    env = getServerEnv();
  } catch {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  if (!authorized(request, env.cronSecret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: due, error } = await admin
    .from("file_metadata")
    .select("id, center_id, bucket, object_path")
    .is("deleted_at", null)
    .lte("delete_after", new Date().toISOString())
    .limit(500);
  if (error) {
    logError("retention.select", error);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
  let deleted = 0;
  for (const f of due ?? []) {
    if (!(await deleteStoredFile(admin, f))) continue;
    await admin.from("audit_logs").insert({ center_id: f.center_id, actor_id: null, action: "file.deleted_retention", entity_type: "file", entity_id: f.id });
    deleted++;
  }
  return NextResponse.json({ ok: true, deleted, remaining: (due?.length ?? 0) - deleted });
}
