import { INTL_LOCALE, type Locale } from "./config";

export function formatDate(value: string | Date | null | undefined, locale: Locale): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Almaty" }).format(d);
}

export function formatDateTime(value: string | Date | null | undefined, locale: Locale): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Almaty",
  }).format(d);
}

export function formatNumber(value: number | string | null | undefined, locale: Locale, digits = 0): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat(INTL_LOCALE[locale], { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(n);
}

export function formatPercent(value: number | string | null | undefined, locale: Locale): string {
  const s = formatNumber(value, locale, 1);
  return s === "—" ? s : `${s}%`;
}

export function formatMonth(ym: string, locale: Locale): string {
  const [y, m] = ym.split("-").map(Number);
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], { month: "short", year: "numeric" }).format(new Date(y!, (m ?? 1) - 1, 1));
}
