/**
 * CSV writer for exports. Adds a UTF-8 BOM (so Excel opens Cyrillic/Kazakh
 * text correctly) and neutralises spreadsheet formula injection: any cell
 * starting with = + - @ (or tab/CR) is prefixed with an apostrophe.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = typeof value === "number" ? String(value) : String(value);
  if (typeof value !== "number" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][], delimiter = ";"): string {
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(delimiter));
  return `﻿${lines.join("\r\n")}\r\n`;
}

export function csvResponseHeaders(filename: string): HeadersInit {
  return {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename.replace(/[^\w.-]/g, "_")}"`,
    "Cache-Control": "private, no-store",
  };
}
