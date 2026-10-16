"use client";
import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/card";
import { Field, FormError, Input } from "@/components/ui/form";
import { useI18n } from "@/lib/i18n/client";
import { requestPasswordResetAction, setPasswordAction, signInAction, type AuthFormState } from "@/server/actions/auth";

export function LoginForm({ next }: { next: string }) {
  const { t } = useI18n();
  const [state, action, pending] = useActionState<AuthFormState, FormData>(signInAction, {});
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="next" value={next} />
      <Field id="email" label={t.auth.email}>
        <Input id="email" name="email" type="email" autoComplete="email" required inputMode="email" />
      </Field>
      <Field id="password" label={t.auth.password}>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      <FormError message={state.error} />
      <Button type="submit" size="lg" loading={pending}>
        {pending ? t.auth.signingIn : t.auth.signIn}
      </Button>
      <Link href="/forgot-password" className="text-center text-sm text-primary hover:underline">
        {t.auth.forgot}
      </Link>
      <Link href="/register" className="text-center text-sm font-medium text-primary hover:underline">
        {t.auth.registerLink}
      </Link>
    </form>
  );
}

export function ForgotPasswordForm() {
  const { t } = useI18n();
  const [state, action, pending] = useActionState<AuthFormState, FormData>(requestPasswordResetAction, {});
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <Field id="email" label={t.auth.email}>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>
      <FormError message={state.error} />
      {state.message ? <Notice tone="success">{state.message}</Notice> : null}
      <Button type="submit" size="lg" loading={pending}>
        {t.auth.resetSend}
      </Button>
      <Link href="/login" className="text-center text-sm text-primary hover:underline">
        {t.auth.backToLogin}
      </Link>
    </form>
  );
}

export function SetPasswordForm() {
  const { t } = useI18n();
  const [state, action, pending] = useActionState<AuthFormState, FormData>(setPasswordAction, {});
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <Field id="password" label={t.auth.newPassword} hint={t.auth.setPasswordText}>
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required />
      </Field>
      <Field id="confirm" label={t.auth.confirmPassword}>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={10} required />
      </Field>
      <FormError message={state.error} />
      <Button type="submit" size="lg" loading={pending}>
        {t.common.save}
      </Button>
    </form>
  );
}
