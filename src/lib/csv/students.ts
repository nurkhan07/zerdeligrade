/**
 * Student CSV import: parsing, header detection (ru / kk / en) and row
 * validation. Pure functions, shared by the browser preview and the server
 * action (which re-validates everything before inserting).
 */
import Papa from "papaparse";
import { z } from "zod";

export const MAX_IMPORT_ROWS = 2000;

type Column = "last_name" | "first_name" | "student_code" | "class_name";

const HEADER_ALIASES: Record<Column, string[]> = {
  last_name: ["last_name", "lastname", "surname", "фамилия", "тегі"],
  first_name: ["first_name", "firstname", "name", "имя", "аты", "есімі"],
  student_code: ["student_code", "code", "код", "код ученика", "оқушы коды"],
  class_name: ["class", "class_name", "group", "класс", "группа", "сынып", "топ", "класс / группа", "сынып / топ"],
};

export const studentImportRowSchema = z.object({
  last_name: z.string().trim().min(1, "required").max(100, "too_long"),
  first_name: z.string().trim().min(1, "required").max(100, "too_long"),
  student_code: z
    .string()
    .trim()
    .max(32, "too_long")
    .regex(/^[A-Za-z0-9_-]*$/, "invalid_code")
    .transform((v) => (v === "" ? null : v)),
  class_name: z
    .string()
    .trim()
    .max(100, "too_long")
    .transform((v) => (v === "" ? null : v)),
});

export type StudentImportRow = z.output<typeof studentImportRowSchema>;

export type ImportIssue =
  | "required"
  | "too_long"
  | "invalid_code"
  | "duplicate_code_in_file"
  | "duplicate_code_existing"
  | "unknown_class"
  | "possible_duplicate_name";

export interface PreviewRow {
  line: number;
  raw: Record<Column, string>;
  data: StudentImportRow | null;
  classId: string | null;
  errors: Array<{ field: string; issue: ImportIssue }>;
  warnings: Array<{ field: string; issue: ImportIssue }>;
}

export interface ImportPreview {
  rows: PreviewRow[];
  missingColumns: Column[];
  tooManyRows: boolean;
  validCount: number;
}

export interface ImportContext {
  /** lower-cased student codes already present in the center */
  existingCodes: Set<string>;
  /** "last|first" lower-cased names already present in the center */
  existingNames: Set<string>;
  /** lower-cased class name -> class id */
  classesByName: Map<string, string>;
}

function normalizeHeader(h: string): string {
  return h.replace(/^﻿/, "").trim().toLowerCase();
}

export function mapHeaders(headers: string[]): Partial<Record<Column, string>> {
  const out: Partial<Record<Column, string>> = {};
  for (const h of headers) {
    const n = normalizeHeader(h);
    for (const key of Object.keys(HEADER_ALIASES) as Column[]) {
      if (!out[key] && HEADER_ALIASES[key].includes(n)) out[key] = h;
    }
  }
  return out;
}

export function parseCsv(text: string): { headers: string[]; records: Record<string, string>[] } {
  const res = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    delimitersToGuess: [",", ";", "\t"],
  });
  return { headers: res.meta.fields ?? [], records: res.data };
}

export function buildImportPreview(text: string, ctx: ImportContext): ImportPreview {
  const { headers, records } = parseCsv(text);
  const map = mapHeaders(headers);
  const missingColumns = (["last_name", "first_name"] as const).filter((k) => !map[k]);
  if (missingColumns.length) return { rows: [], missingColumns: [...missingColumns], tooManyRows: false, validCount: 0 };

  const seenCodes = new Set<string>();
  const rows: PreviewRow[] = records.slice(0, MAX_IMPORT_ROWS).map((rec, i) => {
    const cell = (col: Column) => {
      const header = map[col];
      return header ? (rec[header] ?? "") : "";
    };
    const raw: Record<Column, string> = {
      last_name: cell("last_name"),
      first_name: cell("first_name"),
      student_code: cell("student_code"),
      class_name: cell("class_name"),
    };
    const parsed = studentImportRowSchema.safeParse(raw);
    const errors: PreviewRow["errors"] = [];
    const warnings: PreviewRow["warnings"] = [];
    let data: StudentImportRow | null = null;
    let classId: string | null = null;
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push({ field: String(issue.path[0] ?? ""), issue: issue.message as ImportIssue });
      }
    } else {
      data = parsed.data;
      if (data.student_code) {
        const code = data.student_code.toLowerCase();
        if (ctx.existingCodes.has(code)) errors.push({ field: "student_code", issue: "duplicate_code_existing" });
        else if (seenCodes.has(code)) errors.push({ field: "student_code", issue: "duplicate_code_in_file" });
        seenCodes.add(code);
      }
      if (data.class_name) {
        classId = ctx.classesByName.get(data.class_name.toLowerCase()) ?? null;
        if (!classId) errors.push({ field: "class_name", issue: "unknown_class" });
      }
      if (ctx.existingNames.has(`${data.last_name}|${data.first_name}`.toLowerCase())) {
        warnings.push({ field: "last_name", issue: "possible_duplicate_name" });
      }
    }
    return { line: i + 2, raw, data, classId, errors, warnings };
  });
  return {
    rows,
    missingColumns: [],
    tooManyRows: records.length > MAX_IMPORT_ROWS,
    validCount: rows.filter((r) => r.errors.length === 0).length,
  };
}
