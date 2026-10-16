import type { Metadata } from "next";
import { AuthCard } from "@/components/auth/auth-card";
import { ForgotPasswordForm } from "@/components/auth/auth-forms";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.auth.resetTitle };
}

export default async function ForgotPasswordPage() {
  const { t } = await getI18n();
  return (
    <AuthCard title={t.auth.resetTitle} subtitle={t.auth.resetText}>
      <ForgotPasswordForm />
    </AuthCard>
  );
}
