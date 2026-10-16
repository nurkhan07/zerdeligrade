import kk from "./dictionaries/kk";
import ru, { type Dictionary } from "./dictionaries/ru";

export const LOCALES = ["kk", "ru"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "kk";
export const LOCALE_COOKIE = "zg_locale";

export const dictionaries: Record<Locale, Dictionary> = { kk, ru };

export function isLocale(v: unknown): v is Locale {
  return v === "kk" || v === "ru";
}

/** Intl locale tags used for dates and numbers. */
export const INTL_LOCALE: Record<Locale, string> = { kk: "kk-KZ", ru: "ru-RU" };

/** Replaces {placeholders} in a dictionary string. */
export function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));
}

export type { Dictionary };
