import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canAccess, type NavKey, type PermissionContext, type Role } from "./permissions";

export const CENTER_COOKIE = "zg_center";
export const ALL_CENTERS = "all";

export interface CenterLite {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
  is_demo: boolean;
}

export interface MembershipRow {
  center_id: string;
  role: "center_admin" | "teacher";
  can_finalize: boolean;
  is_active: boolean;
}

export interface AppContext extends PermissionContext {
  userId: string;
  email: string;
  fullName: string;
  isHq: boolean;
  memberships: MembershipRow[];
  centers: CenterLite[];
  activeCenter: CenterLite | null;
}

/**
 * Resolves the signed-in user, their memberships and the active center.
 * Cached per request. Returns null when nobody is signed in.
 */
export const getAppContext = cache(async (): Promise<AppContext | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: profile }, { data: memberships }, { data: centers }] = await Promise.all([
    supabase.from("profiles").select("full_name, is_hq_admin, is_active").eq("id", user.id).maybeSingle(),
    supabase.from("center_memberships").select("center_id, role, can_finalize, is_active").eq("user_id", user.id).eq("is_active", true),
    supabase.from("centers").select("id, name, code, is_active, is_demo").eq("is_active", true).order("name"),
  ]);

  const isHq = Boolean(profile?.is_hq_admin && profile.is_active);
  const ms = ((memberships ?? []) as MembershipRow[]).filter((m) => (centers ?? []).some((c) => c.id === m.center_id));
  const centerList = (centers ?? []) as CenterLite[];

  const store = await cookies();
  const requested = store.get(CENTER_COOKIE)?.value;
  let activeCenterId: string | null;
  if (isHq) {
    activeCenterId = requested && requested !== ALL_CENTERS && centerList.some((c) => c.id === requested) ? requested : null;
  } else {
    activeCenterId = ms.some((m) => m.center_id === requested) ? requested! : (ms[0]?.center_id ?? null);
  }
  const membership = ms.find((m) => m.center_id === activeCenterId);
  const role: Role = isHq ? "hq_admin" : (membership?.role ?? "teacher");

  return {
    userId: user.id,
    email: user.email ?? "",
    fullName: profile?.full_name || user.email || "",
    isHq,
    memberships: ms,
    centers: isHq ? centerList : centerList.filter((c) => ms.some((m) => m.center_id === c.id)),
    activeCenterId,
    activeCenter: centerList.find((c) => c.id === activeCenterId) ?? null,
    role,
    canFinalize: isHq || membership?.role === "center_admin" || Boolean(membership?.can_finalize),
  };
});

/** For pages/layouts: signed-in staff with at least one center (or HQ). */
export async function requireContext(nav?: NavKey): Promise<AppContext> {
  const ctx = await getAppContext();
  if (!ctx) redirect("/login");
  if (!ctx.isHq && ctx.memberships.length === 0) redirect("/no-access");
  if (nav && !canAccess(nav, ctx.role)) redirect("/dashboard");
  return ctx;
}

/** For server actions / route handlers: throws instead of redirecting. */
export async function requireActionContext(nav?: NavKey): Promise<AppContext> {
  const ctx = await getAppContext();
  if (!ctx || (!ctx.isHq && ctx.memberships.length === 0)) throw new AuthError("unauthorized");
  if (nav && !canAccess(nav, ctx.role)) throw new AuthError("forbidden");
  return ctx;
}

export class AuthError extends Error {
  constructor(public readonly code: "unauthorized" | "forbidden") {
    super(code);
  }
}
