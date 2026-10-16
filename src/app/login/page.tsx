import type { Metadata } from "next";
import { AuthCard } from "@/components/auth/auth-card";
import { LoginForm } from "@/components/auth/auth-forms";
import { getI18n } from "@/lib/i18n/server";
import { str } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.auth.signIn };
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { t } = await getI18n();
  const sp = await searchParams;
  const next = str(sp.next);
  return (
    <AuthCard title={t.auth.loginTitle} subtitle={t.auth.loginSubtitle}>
      {str(sp.error) === "link" ? <p className="mb-4 text-sm text-danger" role="alert">{t.auth.linkInvalid}</p> : null}
      <LoginForm next={next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard"} />
    </AuthCard>
  );
}
