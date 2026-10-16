import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Escapes LIKE/ILIKE wildcards in user search input. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Reads a positive integer page number from search params. */
export function pageParam(v: string | string[] | undefined): number {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

export function str(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

export function uuidParam(v: string | string[] | undefined): string | null {
  const s = str(v);
  return isUuid(s) ? s : null;
}

/**
 * Prepares free-text search for a PostgREST `or=(...)` filter: removes the
 * characters that have syntactic meaning there, including LIKE wildcards.
 */
export function searchPattern(q: string): string | null {
  const cleaned = q.replace(/[,()"'\\*:%_.]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
  return cleaned ? `*${cleaned}*` : null;
}
