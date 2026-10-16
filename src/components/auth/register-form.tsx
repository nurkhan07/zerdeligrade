"use client";
import Link from "next/link";
import { useActionState, useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/card";
import { Field, FormError, Input } from "@/components/ui/form";
import { fmt } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/client";
import { resendSignupCodeAction, signUpAction, verifySignupCodeAction, type SignUpState } from "@/server/actions/auth";

export function RegisterForm() {
  const { t } = useI18n();
  const [state, action, pending] = useActionState<SignUpState, FormData>(signUpAction, {});
  if (state.email) return <CodeStep email={state.email} />;
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <Field id="full_name" label={t.auth.fullName}>
        <Input id="full_name" name="full_name" autoComplete="name" required />
      </Field>
      <Field id="email" label={t.auth.email}>
        <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" required />
      </Field>
      <Field id="password" label={t.auth.password} hint={t.auth.setPasswordText}>
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required />
      </Field>
      <Field id="confirm" label={t.auth.confirmPassword}>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={10} required />
      </Field>
      <FormError message={state.error} />
      <Button type="submit" size="lg" loading={pending}>
        {t.auth.register}
      </Button>
      <Link href="/login" className="text-center text-sm text-primary hover:underline">
        {t.auth.backToLogin}
      </Link>
    </form>
  );
}

function CodeStep({ email }: { email: string }) {
  const { t } = useI18n();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [wait, setWait] = useState(60);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const res = await verifySignupCodeAction(email, code);
          if (res?.error) setError(res.error);
        });
      }}
    >
      <h2 className="text-lg font-semibold">{t.auth.codeTitle}</h2>
      <p className="text-sm text-muted">{fmt(t.auth.codeText, { email })}</p>
      <Field id="code" label={t.auth.code}>
        <Input
          id="code"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 10))}
          inputMode="numeric"
          autoComplete="one-time-code"
          className="text-center font-mono text-xl tracking-[0.4em]"
          required
        />
      </Field>
      <FormError message={error} />
      {info ? <Notice tone="success">{info}</Notice> : null}
      <Button type="submit" size="lg" loading={pending} disabled={code.length < 6}>
        {t.auth.confirm}
      </Button>
      <Button
        type="button"
        variant="ghost"
        disabled={wait > 0 || pending}
        onClick={() =>
          start(async () => {
            const res = await resendSignupCodeAction(email);
            setError(res.error ?? null);
            setInfo(res.message ?? null);
            setWait(60);
          })
        }
      >
        {wait > 0 ? fmt(t.auth.resendIn, { s: wait }) : t.auth.resend}
      </Button>
    </form>
  );
}
