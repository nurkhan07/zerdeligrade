import "server-only";
import { logError } from "@/lib/errors";
import type { AdminSupabase } from "@/lib/supabase/admin";

/**
 * Removes a stored photo and marks its metadata row as deleted. Used by the
 * retention job and when a result is voided. Returns false if storage
 * removal failed (the retention job will retry later).
 */
export async function deleteStoredFile(
  admin: AdminSupabase,
  file: { id: string; bucket: string; object_path: string },
): Promise<boolean> {
  const { error } = await admin.storage.from(file.bucket).remove([file.object_path]);
  if (error) {
    logError("files.remove", error, { id: file.id });
    return false;
  }
  await admin.from("file_metadata").update({ deleted_at: new Date().toISOString() }).eq("id", file.id);
  return true;
}
