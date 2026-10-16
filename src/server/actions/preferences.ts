"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ALL_CENTERS, CENTER_COOKIE, getAppContext } from "@/lib/auth/context";
import { LOCALE_COOKIE, isLocale } from "@/lib/i18n/config";
import { getPublicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

const YEAR = 60 * 60 * 24 * 365;

export async function setLocaleAction(locale: string): Promise<void> {
  if (!isLocale(locale)) return;
  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, { path: "/", maxAge: YEAR, sameSite: "lax", httpOnly: false });
  if (getPublicEnv()) {
    const ctx = await getAppContext();
    if (ctx) {
      const supabase = await createClient();
      await supabase.from("profiles").update({ preferred_locale: locale }).eq("id", ctx.userId);
    }
  }
  revalidatePath("/", "layout");
}

export async function setActiveCenterAction(centerId: string): Promise<void> {
  const ctx = await getAppContext();
  if (!ctx) return;
  const allowed = (centerId === ALL_CENTERS && ctx.isHq) || ctx.centers.some((c) => c.id === centerId);
  if (!allowed) return;
  const store = await cookies();
  store.set(CENTER_COOKIE, centerId, { path: "/", maxAge: YEAR, sameSite: "lax", httpOnly: true, secure: process.env.NODE_ENV === "production" });
  revalidatePath("/", "layout");
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const store = await cookies();
  store.delete(CENTER_COOKIE);
  redirect("/login");
}
