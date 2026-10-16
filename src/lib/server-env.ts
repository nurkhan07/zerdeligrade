import "server-only";

export interface ServerEnv {
  serviceRoleKey: string;
  storageBucket: string;
  fileRetentionDays: number;
  cronSecret: string | null;
}

export function getServerEnv(): ServerEnv {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey || serviceRoleKey === "your-service-role-key") {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured on the server.");
  }
  const days = Number(process.env.FILE_RETENTION_DAYS ?? 365);
  return {
    serviceRoleKey,
    storageBucket: process.env.SUPABASE_STORAGE_BUCKET || "answer-sheets",
    fileRetentionDays: Number.isFinite(days) && days >= 1 ? Math.min(days, 3650) : 365,
    cronSecret: process.env.CRON_SECRET || null,
  };
}
