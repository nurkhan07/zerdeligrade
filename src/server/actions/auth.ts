"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { LOCALE_COOKIE, isLocale } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { requirePublicEnv } from "@/lib/env";
import { logError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

export interface AuthFormState {
  error?: string;
  message?: string;
}

/** Only allow same-site relative redirects. */
function safeNext(v: FormDataEntryValue | null): string {
  const s = typeof v === "string" ? v : "";
  return s.startsWith("/") && !s.startsWith("//") && !s.startsWith("/\\") ? s : "/dashboard";
}

export async function signInAction(_: AuthFormState, form: FormData): Promise<AuthFormState> {
  const { t } = await getI18n();
  const parsed = z
    .object({ email: z.string().trim().email().max(320), password: z.string().min(1).max(200) })
    .safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: t.auth.invalidCredentials };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error || !data.user) {
    if (error?.status === 429) return { error: t.auth.rateLimited };
    return { error: t.auth.invalidCredentials };
  }
  const { data: profile } = await supabase.from("profiles").select("preferred_locale").eq("id", data.user.id).maybeSingle();
  if (profile && isLocale(profile.preferred_locale)) {
    (await cookies()).set(LOCALE_COOKIE, profile.preferred_locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  }
  redirect(safeNext(form.get("next")));
}

export async function requestPasswordResetAction(_: AuthFormState, form: FormData): Promise<AuthFormState> {
  const { t } = await getI18n();
  const email = z.string().trim().email().max(320).safeParse(form.get("email"));
  if (!email.success) return { error: t.validation.email };
  const supabase = await createClient();
  const { siteUrl } = requirePublicEnv();
  const { error } = await supabase.auth.resetPasswordForEmail(email.data, {
    redirectTo: `${siteUrl}/auth/confirm?next=/auth/set-password`,
  });
  if (error) {
    if (error.status === 429) return { error: t.auth.rateLimited };
    logError("auth.reset", error);
  }
  // Same answer whether or not the address exists (no account enumeration).
  return { message: t.auth.resetSent };
}

export async function setPasswordAction(_: AuthFormState, form: FormData): Promise<AuthFormState> {
  const { t } = await getI18n();
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  if (password.length < 10 || password.length > 200) return { error: t.auth.passwordTooShort };
  if (password !== confirm) return { error: t.auth.passwordMismatch };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: t.auth.linkInvalid };
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    logError("auth.set_password", error);
    return { error: error.status === 422 ? t.auth.passwordTooShort : t.common.errorGeneric };
  }
  redirect("/dashboard");
}

// ------------------------------------------------------------ registration

export interface SignUpState {
  error?: string;
  email?: string;
}

const signUpSchema = z.object({
  full_name: z.string().trim().min(2).max(200),
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(10).max(200),
  confirm: z.string(),
});

/** Step 1: create the account; Supabase e-mails a one-time code (template "Confirm signup" uses {{ .Token }}). */
export async function signUpAction(_: SignUpState, form: FormData): Promise<SignUpState> {
  const { t, locale } = await getI18n();
  const p = signUpSchema.safeParse(Object.fromEntries(form));
  if (!p.success) {
    const field = p.error.issues[0]?.path[0];
    return { error: field === "password" ? t.auth.passwordTooShort : field === "email" ? t.validation.email : t.errors.validation };
  }
  if (p.data.password !== p.data.confirm) return { error: t.auth.passwordMismatch };
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: p.data.email,
    password: p.data.password,
    // The default Supabase e-mail (no custom SMTP) contains a link instead of a
    // code; it must land on /auth/confirm, which signs the user in.
    options: {
      data: { full_name: p.data.full_name, preferred_locale: locale },
      emailRedirectTo: `${requirePublicEnv().siteUrl}/auth/confirm?next=/no-access`,
    },
  });
  if (error) {
    if (error.status === 429) return { error: t.auth.rateLimited };
    if (/registered|exists/i.test(error.message)) return { error: t.auth.emailTaken };
    logError("auth.sign_up", error);
    // Supabase's built-in mailer only delivers to project team members and a few
    // e-mails per hour; a custom SMTP server removes this limit.
    if (/sending .*email/i.test(error.message)) return { error: t.auth.emailSendFailed };
    return { error: t.common.errorGeneric };
  }
  // With e-mail confirmation on, an existing address returns a user without identities.
  if (data.user && (data.user.identities?.length ?? 0) === 0) return { error: t.auth.emailTaken };
  return { email: p.data.email };
}

/** Step 2: verify the code; on success the user is signed in and goes to the access-request screen. */
export async function verifySignupCodeAction(email: string, code: string): Promise<{ error?: string }> {
  const { t } = await getI18n();
  const e = z.string().email().safeParse(email);
  const c = z.string().regex(/^\d{6,10}$/).safeParse(code.replace(/\s/g, ""));
  if (!e.success || !c.success) return { error: t.auth.codeInvalid };
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ email: e.data, token: c.data, type: "signup" });
  if (error) return { error: error.status === 429 ? t.auth.rateLimited : t.auth.codeInvalid };
  redirect("/no-access");
}

export async function resendSignupCodeAction(email: string): Promise<{ error?: string; message?: string }> {
  const { t } = await getI18n();
  const e = z.string().email().safeParse(email);
  if (!e.success) return { error: t.validation.email };
  const supabase = await createClient();
  const { error } = await supabase.auth.resend({ type: "signup", email: e.data });
  if (error) {
    if (error.status === 429) return { error: t.auth.rateLimited };
    return { error: /sending .*email/i.test(error.message) ? t.auth.emailSendFailed : t.common.errorGeneric };
  }
  return { message: t.auth.codeSent };
}
