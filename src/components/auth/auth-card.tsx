import Image from "next/image";
import type { ReactNode } from "react";
import { LanguageSwitch } from "@/components/shell/language-switch";

export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <header className="flex items-center justify-between px-4 py-4 sm:px-8">
        <Image src="/brand/zerdeligrade-logo.png" alt="Zerdeli" width={114} height={40} priority className="h-9 w-auto" />
        <LanguageSwitch />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-md rounded-[var(--radius-card)] bg-white p-6 shadow-[var(--shadow-card)] sm:p-8">
          <p className="mb-1 text-sm font-semibold uppercase tracking-wider text-brand">ZerdeliGrade</p>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle ? <p className="mt-2 text-[15px] text-muted">{subtitle}</p> : null}
          <div className="mt-6">{children}</div>
        </div>
      </main>
    </div>
  );
}
