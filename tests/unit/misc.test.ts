import { describe, expect, it } from "vitest";
import { can, canAccess, NAV_ACCESS, type PermissionContext } from "@/lib/auth/permissions";
import { csvCell, toCsv } from "@/lib/csv/write";
import { dictionaries, fmt } from "@/lib/i18n/config";
import { buildSheetDrawing } from "@/lib/omr/drawing";
import { buildLayout } from "@/lib/omr/layout";
import { renderSheetsPdf } from "@/lib/omr/pdf";
import { renderSheetSvg } from "@/lib/omr/svg";
import { searchPattern } from "@/lib/utils";

describe("CSV export", () => {
  it("neutralises spreadsheet formulas and quotes special characters", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell("+7 777")).toBe("'+7 777");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell("a;b")).toBe('"a;b"');
    expect(csvCell(null)).toBe("");
  });
  it("starts with a UTF-8 BOM for Excel", () => {
    expect(toCsv(["Тегі"], [["Әлия"]]).startsWith("﻿Тегі\r\nӘлия")).toBe(true);
  });
});

describe("search input", () => {
  it("strips PostgREST filter syntax and wildcards", () => {
    expect(searchPattern("Ivan,first_name.eq.x)")).toBe("*Ivan first name eq x*");
    expect(searchPattern("%_*")).toBeNull();
    expect(searchPattern("  Әлия  ")).toBe("*Әлия*");
  });
});

describe("role model", () => {
  const teacher: PermissionContext = { role: "teacher", activeCenterId: "c1", canFinalize: false };
  const admin: PermissionContext = { role: "center_admin", activeCenterId: "c1", canFinalize: true };
  const hq: PermissionContext = { role: "hq_admin", activeCenterId: null, canFinalize: true };

  it("hides HQ-only and admin pages", () => {
    expect(canAccess("network", "center_admin")).toBe(false);
    expect(canAccess("network", "teacher")).toBe(false);
    expect(canAccess("network", "hq_admin")).toBe(true);
    expect(canAccess("audit", "teacher")).toBe(false);
    expect(canAccess("users", "teacher")).toBe(false);
    expect(Object.keys(NAV_ACCESS)).toHaveLength(14);
  });
  it("limits who can assign which role", () => {
    expect(can.assignableRoles(teacher)).toEqual([]);
    expect(can.assignableRoles(admin)).toEqual(["teacher"]);
    expect(can.assignableRoles(hq)).toEqual(["center_admin", "teacher"]);
  });
  it("respects the teacher finalize flag", () => {
    expect(can.finalizeResults(teacher)).toBe(false);
    expect(can.finalizeResults({ ...teacher, canFinalize: true })).toBe(true);
    expect(can.reopenResults(teacher)).toBe(false);
    expect(can.manageStudents(teacher)).toBe(false);
    expect(can.manageStudents({ ...hq })).toBe(false); // HQ must pick a center first
  });
});

describe("localization", () => {
  function leaves(o: unknown, prefix = ""): Array<[string, unknown]> {
    if (typeof o === "string" || Array.isArray(o)) return [[prefix, o]];
    return Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
  }
  it("has a non-empty Kazakh and Russian string for every key", () => {
    const ru = new Map(leaves(dictionaries.ru));
    const kk = new Map(leaves(dictionaries.kk));
    expect([...kk.keys()].sort()).toEqual([...ru.keys()].sort());
    for (const [k, v] of [...ru, ...kk]) {
      if (Array.isArray(v)) expect(v.length, k).toBeGreaterThan(0);
      else expect(String(v).trim().length, k).toBeGreaterThan(0);
    }
  });
  it("keeps the same placeholders in both languages", () => {
    const ph = (s: unknown) => (String(s).match(/\{\w+\}/g) ?? []).sort().join(",");
    const kk = new Map(leaves(dictionaries.kk));
    for (const [k, v] of leaves(dictionaries.ru)) expect(ph(kk.get(k)), k).toBe(ph(v));
    expect(fmt("{a} / {b}", { a: 1, b: "x" })).toBe("1 / x");
  });
});

describe("printable sheet outputs", () => {
  const drawing = buildSheetDrawing({
    layout: buildLayout(Array.from({ length: 60 }, (_, i) => (i % 10 === 9 ? 2 : 5))),
    sheetCode: "K7M2Q9RXT4",
    labels: { ...dictionaries.kk.sheetPrint, instructions: [...dictionaries.kk.sheetPrint.instructions] },
    testTitle: "Алгебра <script>",
    studentName: "Нұрланқызы Әлия",
    hasTrueFalse: true,
  });
  it("escapes text in the SVG", () => {
    const svg = renderSheetSvg(drawing);
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).not.toContain("<script>");
  });
  it("renders A5 sheets two per A4 landscape page", async () => {
    const a5 = buildSheetDrawing({
      layout: buildLayout(Array.from({ length: 30 }, () => 4), "a5"),
      sheetCode: "K7M2Q9RXT4",
      labels: { ...dictionaries.ru.sheetPrint, instructions: [...dictionaries.ru.sheetPrint.instructions] },
      testTitle: "Тест",
    });
    expect(renderSheetSvg(a5)).toContain('viewBox="0 0 148 210"');
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(await renderSheetsPdf([a5, a5, a5], "A5", "a5"));
    expect(doc.getPageCount()).toBe(2);
    const { width, height } = doc.getPage(0).getSize();
    expect(Math.round(width)).toBe(842); // 297 mm
    expect(Math.round(height)).toBe(595); // 210 mm
  });

  it("renders a valid PDF with Kazakh text", async () => {
    const pdf = await renderSheetsPdf([drawing, drawing], "Test");
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(10_000);
  });
});
