import "server-only";
import { logError } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Appends an entry to the immutable audit log. Clients cannot write audit
 * rows, so this uses the service role. Failures are logged, never shown.
 */
export async function audit(entry: {
  actorId: string;
  centerId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  details?: Record<string, unknown>;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("audit_logs").insert({
      actor_id: entry.actorId,
      center_id: entry.centerId,
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId ?? null,
      details: entry.details ?? {},
    });
    if (error) logError("audit.insert", error, { action: entry.action });
  } catch (error) {
    logError("audit", error, { action: entry.action });
  }
}
