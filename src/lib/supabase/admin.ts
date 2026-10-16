import "server-only";
import { createClient } from "@supabase/supabase-js";
import { requirePublicEnv } from "@/lib/env";
import { getServerEnv } from "@/lib/server-env";

/**
 * Service-role client. BYPASSES RLS. Use only in server code, and only after
 * the caller's permission has been verified with the user-scoped client.
 */
export function createAdminClient() {
  const env = requirePublicEnv();
  const { serviceRoleKey } = getServerEnv();
  return createClient(env.supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export type AdminSupabase = ReturnType<typeof createAdminClient>;
