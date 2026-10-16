import { AuthCard } from "@/components/auth/auth-card";
import { getI18n } from "@/lib/i18n/server";

export default async function SetupPage() {
  const { t } = await getI18n();
  return (
    <AuthCard title={t.setup.title} subtitle={t.setup.text}>
      <pre className="relative overflow-x-auto rounded-[var(--radius-control)] bg-surface p-4 text-xs leading-relaxed">
        {`cp .env.example .env.local
# NEXT_PUBLIC_SUPABASE_URL=...
# NEXT_PUBLIC_SUPABASE_ANON_KEY=...
# SUPABASE_SERVICE_ROLE_KEY=...
npx supabase db push
npm run dev`}
      </pre>
    </AuthCard>
  );
}
