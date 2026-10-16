import { NextResponse, type NextRequest } from "next/server";
import { audit } from "@/lib/audit";
import { getAppContext } from "@/lib/auth/context";
import { logError } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/utils";

export const runtime = "nodejs";

/**
 * Redirects to a 5-minute signed URL for a private answer-sheet photo.
 * Access is decided by RLS on file_metadata (center admins, or the uploader);
 * the service role is used only to sign the URL afterwards.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAppContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const supabase = await createClient();
  const { data: file } = await supabase.from("file_metadata").select("id, center_id, bucket, object_path, deleted_at").eq("id", id).maybeSingle();
  if (!file || file.deleted_at) return NextResponse.json({ error: "not_found" }, { status: 404 });

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.storage.from(file.bucket).createSignedUrl(file.object_path, 300);
    if (error || !data) throw error ?? new Error("sign failed");
    await audit({ actorId: ctx.userId, centerId: file.center_id, action: "file.viewed", entityType: "file", entityId: id });
    return NextResponse.redirect(data.signedUrl, { headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) {
    logError("files.sign", error, { id });
    return NextResponse.json({ error: "unavailable" }, { status: 502 });
  }
}
