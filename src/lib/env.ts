/**
 * Environment access. Public values may be used anywhere; server values only
 * in server code (see `serverEnv`, which imports "server-only").
 */
export interface PublicEnv {
  supabaseUrl: string;
  supabaseAnonKey: string;
  siteUrl: string;
}

export function getPublicEnv(): PublicEnv | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey || supabaseUrl.includes("your-project-ref")) return null;
  return {
    supabaseUrl,
    supabaseAnonKey,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  };
}

export function requirePublicEnv(): PublicEnv {
  const env = getPublicEnv();
  if (!env) throw new Error("Supabase is not configured. Copy .env.example to .env.local and fill in the values.");
  return env;
}
