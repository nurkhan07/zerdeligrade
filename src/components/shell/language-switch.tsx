"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setLocaleAction } from "@/server/actions/preferences";
import { useI18n } from "@/lib/i18n/client";
import { LOCALES, dictionaries } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";

/** One-click Kazakh / Russian switch. Persists in a cookie and the user profile. */
export function LanguageSwitch({ className }: { className?: string }) {
  const { locale, t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div role="group" aria-label={t.nav.switchLanguage} className={cn("inline-flex rounded-full border border-line bg-white p-0.5", className)}>
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={l === locale}
          disabled={pending}
          onClick={() =>
            start(async () => {
              if (l === locale) return;
              await setLocaleAction(l);
              router.refresh();
            })
          }
          className={cn(
            "h-8 rounded-full px-3 text-sm font-medium transition-colors",
            l === locale ? "bg-accent text-ink" : "text-muted hover:text-ink",
          )}
        >
          {dictionaries[l].meta.short}
        </button>
      ))}
    </div>
  );
}
