"use client";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  BarChart3,
  Building2,
  ClipboardList,
  Copy,
  Database,
  GraduationCap,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  Printer,
  ScanLine,
  ScrollText,
  Settings,
  UserCog,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { canAccess, type NavKey, type Role } from "@/lib/auth/permissions";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { setActiveCenterAction, signOutAction } from "@/server/actions/preferences";
import { LanguageSwitch } from "./language-switch";
import { NAV_ITEMS } from "./nav-items";

const ICONS: Record<NavKey, LucideIcon> = {
  dashboard: LayoutDashboard,
  tests: ClipboardList,
  templates: Copy,
  answerSheets: Printer,
  scan: ScanLine,
  results: ListChecks,
  analytics: BarChart3,
  students: Users,
  classes: GraduationCap,
  centers: Building2,
  users: UserCog,
  network: Database,
  audit: ScrollText,
  settings: Settings,
};

export interface ShellProps {
  role: Role;
  fullName: string;
  email: string;
  isHq: boolean;
  centers: Array<{ id: string; name: string; code: string; is_demo: boolean }>;
  activeCenterId: string | null;
  children: ReactNode;
}

function Brand() {
  return (
    <Link href="/dashboard" className="flex items-center gap-2.5 px-2" aria-label="ZerdeliGrade">
      <Image src="/brand/zerdeligrade-logo.png" alt="Zerdeli" width={114} height={40} priority className="h-9 w-auto" />
    </Link>
  );
}

function NavList({ role, onNavigate }: { role: Role; onNavigate?: () => void }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const groups: Array<{ id: "work" | "people" | "network"; label: string }> = [
    { id: "work", label: t.nav.groupWork },
    { id: "people", label: t.nav.groupPeople },
    { id: "network", label: t.nav.groupNetwork },
  ];
  return (
    <nav aria-label="main" className="flex flex-col gap-5">
      {groups.map((g) => {
        const items = NAV_ITEMS.filter((i) => i.group === g.id && canAccess(i.key, role));
        if (!items.length) return null;
        return (
          <div key={g.id}>
            <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted/80">{g.label}</p>
            <ul className="flex flex-col gap-0.5">
              {items.map((item) => {
                const Icon = ICONS[item.key];
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <li key={item.key}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-3 rounded-[var(--radius-control)] px-3 py-2 text-[15px] transition-colors",
                        active ? "bg-primary-soft font-medium text-primary" : "text-ink hover:bg-surface",
                      )}
                    >
                      <Icon className="size-[18px] shrink-0" aria-hidden />
                      <span className="truncate">{t.nav[item.key]}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function CenterSwitcher({ isHq, centers, activeCenterId }: Pick<ShellProps, "isHq" | "centers" | "activeCenterId">) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!isHq && centers.length <= 1) {
    const c = centers[0];
    return c ? <span className="truncate text-sm text-muted">{c.name}</span> : null;
  }
  return (
    <label className="flex min-w-0 items-center gap-2 text-sm">
      <span className="sr-only sm:not-sr-only sm:text-muted">{t.centerSwitch.label}</span>
      <select
        className="h-9 min-w-0 max-w-56 rounded-full border border-line bg-white px-3 text-sm"
        value={activeCenterId ?? "all"}
        disabled={pending}
        onChange={(e) => {
          const v = e.target.value;
          start(async () => {
            await setActiveCenterAction(v);
            router.refresh();
          });
        }}
      >
        {isHq ? <option value="all">{t.centerSwitch.allCenters}</option> : null}
        {centers.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} ({c.code}){c.is_demo ? ` · ${t.common.demo}` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

function UserBlock({ fullName, role, compact }: { fullName: string; role: Role; compact?: boolean }) {
  const { t } = useI18n();
  return (
    <div className={cn("flex items-center gap-3", compact ? "" : "rounded-[var(--radius-control)] border border-line p-3")}>
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand text-sm font-semibold text-white" aria-hidden>
        {fullName.trim().charAt(0).toUpperCase() || "?"}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{fullName}</p>
        <p className="truncate text-xs text-muted">{t.roles[role]}</p>
      </div>
      <form action={signOutAction}>
        <Button type="submit" variant="ghost" size="icon" aria-label={t.nav.signOut} title={t.nav.signOut}>
          <LogOut />
        </Button>
      </form>
    </div>
  );
}

export function AppShell({ role, fullName, isHq, centers, activeCenterId, children }: ShellProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[264px_minmax(0,1fr)]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-white focus:px-4 focus:py-2">
        {t.common.skipToContent}
      </a>

      {/* Desktop sidebar */}
      <aside className="no-print sticky top-0 hidden h-dvh flex-col gap-6 overflow-y-auto border-r border-line bg-white px-3 py-5 lg:flex">
        <Brand />
        <div className="flex-1">
          <NavList role={role} />
        </div>
        <UserBlock fullName={fullName} role={role} />
      </aside>

      <div className="min-w-0">
        <header className="no-print sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-white/95 px-4 backdrop-blur sm:px-6">
          {/* Mobile menu */}
          <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
            <DialogPrimitive.Trigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label={t.nav.openMenu}>
                <Menu />
              </Button>
            </DialogPrimitive.Trigger>
            <DialogPrimitive.Portal>
              <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-ink/40 lg:hidden" />
              <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 flex w-[86vw] max-w-80 flex-col gap-6 overflow-y-auto bg-white px-3 py-5 shadow-[var(--shadow-pop)] focus:outline-none lg:hidden">
                <DialogPrimitive.Title className="sr-only">{t.nav.openMenu}</DialogPrimitive.Title>
                <DialogPrimitive.Description className="sr-only">{t.common.appName}</DialogPrimitive.Description>
                <div className="flex items-center justify-between">
                  <Brand />
                  <DialogPrimitive.Close asChild>
                    <Button variant="ghost" size="icon" aria-label={t.nav.closeMenu}>
                      <X />
                    </Button>
                  </DialogPrimitive.Close>
                </div>
                <div className="flex-1">
                  <NavList role={role} onNavigate={() => setOpen(false)} />
                </div>
                <UserBlock fullName={fullName} role={role} />
              </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
          </DialogPrimitive.Root>

          <div className="lg:hidden">
            <Image src="/brand/zerdeligrade-logo.png" alt="Zerdeli" width={86} height={30} className="h-7 w-auto" />
          </div>
          <div className="flex min-w-0 flex-1 items-center justify-end gap-3 sm:justify-between">
            <div className="hidden min-w-0 sm:block">
              <CenterSwitcher isHq={isHq} centers={centers} activeCenterId={activeCenterId} />
            </div>
            <LanguageSwitch />
          </div>
        </header>
        <div className="no-print border-b border-line bg-white px-4 py-2 sm:hidden">
          <CenterSwitcher isHq={isHq} centers={centers} activeCenterId={activeCenterId} />
        </div>
        <main id="main" className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
