import { describe, expect, it } from "vitest";
import { encodeSheetPayload, formatSheetCode, generateSheetCode, isValidSheetCode, parseSheetPayload } from "@/lib/omr/sheet-code";
import { buildLayout, GEOMETRY, MARKERS, MAX_QUESTIONS, SHEET_FORMATS } from "@/lib/omr/layout";

describe("sheet codes", () => {
  it("generates valid, unambiguous, unique codes", () => {
    const codes = new Set(Array.from({ length: 2000 }, () => generateSheetCode()));
    expect(codes.size).toBe(2000);
    for (const c of codes) {
      expect(isValidSheetCode(c)).toBe(true);
      expect(c).not.toMatch(/[01OI]/);
    }
  });

  it("round-trips through the QR payload and tolerates manual entry", () => {
    const code = "K7M2Q9RXT4";
    expect(parseSheetPayload(encodeSheetPayload(code))).toBe(code);
    expect(parseSheetPayload(formatSheetCode(code).toLowerCase())).toBe(code);
    expect(parseSheetPayload(" k7m2q-9rxt4 ")).toBe(code);
  });

  it("rejects foreign or malformed payloads", () => {
    for (const bad of ["", "https://example.com", "ZG1:K7M2Q9RXT", "ZG1:K7M2Q9RXT0", "ZG2:K7M2Q9RXT4"]) {
      expect(parseSheetPayload(bad)).toBeNull();
    }
    expect(() => encodeSheetPayload("bad")).toThrow();
  });
});

describe("sheet layout", () => {
  it("keeps every bubble inside the marker frame and well separated", () => {
    const layout = buildLayout(Array.from({ length: MAX_QUESTIONS }, () => 5));
    const bubbles = layout.questions.flatMap((q) => q.bubbles);
    for (const b of bubbles) {
      expect(b.cx - b.r).toBeGreaterThan(10);
      expect(b.cx + b.r).toBeLessThan(200);
      // Stay out of every marker's 6.5 mm quiet zone (checked by the scanner).
      for (const m of Object.values(MARKERS)) {
        const clear = Math.abs(b.cx - m.x) > 6.5 + b.r || Math.abs(b.cy - m.y) > 6.5 + b.r;
        expect(clear).toBe(true);
      }
    }
    for (let i = 0; i < bubbles.length; i++)
      for (let j = i + 1; j < bubbles.length; j++) {
        const a = bubbles[i]!;
        const c = bubbles[j]!;
        expect(Math.hypot(a.cx - c.cx, a.cy - c.cy)).toBeGreaterThan(a.r + c.r + 1);
      }
  });

  it.each(SHEET_FORMATS)("%s: bubbles stay inside the page and clear of marker quiet zones", (format) => {
    const geo = GEOMETRY[format];
    const layout = buildLayout(Array.from({ length: geo.maxQuestions }, () => 5), format);
    for (const b of layout.questions.flatMap((q) => q.bubbles)) {
      expect(b.cx - b.r).toBeGreaterThan(4);
      expect(b.cx + b.r).toBeLessThan(geo.page.width - 4);
      for (const m of Object.values(geo.markers)) {
        expect(Math.abs(b.cx - m.x) > 6.5 + b.r || Math.abs(b.cy - m.y) > 6.5 + b.r).toBe(true);
      }
    }
    expect(() => buildLayout(Array.from({ length: geo.maxQuestions + 1 }, () => 5), format)).toThrow();
  });

  it("validates option counts", () => {
    expect(() => buildLayout([])).toThrow();
    expect(() => buildLayout([6])).toThrow();
    expect(() => buildLayout([1])).toThrow();
    expect(buildLayout([2, 5, 4]).questions.map((q) => q.bubbles.map((b) => b.label).join(""))).toEqual(["AB", "ABCDE", "ABCD"]);
  });
});
