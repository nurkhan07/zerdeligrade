/**
 * Builds the answer sheet as a list of simple drawing primitives (mm units).
 * Both the SVG renderer (screen preview + browser printing) and the PDF
 * renderer consume this list, so print and PDF output are geometrically
 * identical and always match what the scanner expects.
 */
import QRCode from "qrcode";
import { MARKER_SIZE, type OptionLabel, type SheetGeometry, type SheetLayout } from "./layout";
import { encodeSheetPayload, formatSheetCode } from "./sheet-code";

export type Primitive =
  | { t: "rect"; x: number; y: number; w: number; h: number; fill?: string; stroke?: string; sw?: number; rx?: number }
  | { t: "circle"; cx: number; cy: number; r: number; fill?: string; stroke?: string; sw?: number }
  | { t: "line"; x1: number; y1: number; x2: number; y2: number; stroke: string; sw: number }
  | {
      t: "text";
      x: number;
      y: number;
      text: string;
      size: number; // font size in mm
      weight?: "normal" | "bold";
      anchor?: "start" | "middle" | "end";
      fill?: string;
    }
  | { t: "qr"; x: number; y: number; size: number; modules: boolean[][] };

export interface SheetLabels {
  title: string;
  studentName: string;
  studentCode: string;
  className: string;
  date: string;
  test: string;
  center: string;
  instructionsTitle: string;
  instructions: string[];
  correctExample: string;
  wrongExample: string;
  trueFalseNote: string;
  sheetCode: string;
  footer: string;
}

export interface SheetContent {
  layout: SheetLayout;
  sheetCode: string;
  labels: SheetLabels;
  testTitle: string;
  subjectName?: string;
  centerName?: string;
  studentName?: string;
  studentCode?: string;
  className?: string;
  hasTrueFalse?: boolean;
  /** Test-only: pre-filled bubbles, keyed by question position. */
  fills?: Record<number, OptionLabel[]>;
}

const INK = "#000000";
const GREY = "#9AA0A6";
const LIGHT = "#B4B9BF";

export function qrModules(text: string): boolean[][] {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const rows: boolean[][] = [];
  for (let y = 0; y < n; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < n; x++) row.push(Boolean(qr.modules.get(y, x)));
    rows.push(row);
  }
  return rows;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function examples(p: Primitive[], L: SheetLabels, x: number, y: number) {
  // Correct: one fully filled bubble. Wrong: tick / cross.
  p.push({ t: "text", x: x - 4, y: y + 0.8, text: L.correctExample, size: 2.3, anchor: "end" });
  p.push({ t: "circle", cx: x, cy: y, r: 1.8, fill: INK });
  p.push({ t: "text", x: x - 4, y: y + 5.8, text: L.wrongExample, size: 2.3, anchor: "end" });
  p.push({ t: "circle", cx: x, cy: y + 5, r: 1.8, stroke: INK, sw: 0.25 });
  p.push({ t: "line", x1: x - 1.1, y1: y + 5.1, x2: x - 0.2, y2: y + 6.1, stroke: INK, sw: 0.35 });
  p.push({ t: "line", x1: x - 0.2, y1: y + 6.1, x2: x + 1.3, y2: y + 3.9, stroke: INK, sw: 0.35 });
  p.push({ t: "circle", cx: x + 5, cy: y + 5, r: 1.8, stroke: INK, sw: 0.25 });
  p.push({ t: "line", x1: x + 3.9, y1: y + 3.9, x2: x + 6.1, y2: y + 6.1, stroke: INK, sw: 0.35 });
  p.push({ t: "line", x1: x + 6.1, y1: y + 3.9, x2: x + 3.9, y2: y + 6.1, stroke: INK, sw: 0.35 });
}

function qrBlock(p: Primitive[], c: SheetContent, geo: SheetGeometry) {
  const QR = geo.qr;
  p.push({ t: "qr", x: QR.x, y: QR.y, size: QR.size, modules: qrModules(encodeSheetPayload(c.sheetCode)) });
  p.push({ t: "text", x: QR.x + QR.size / 2, y: QR.y + QR.size + 3.6, text: formatSheetCode(c.sheetCode), size: 3, weight: "bold", anchor: "middle" });
  p.push({ t: "text", x: QR.x + QR.size / 2, y: QR.y + QR.size + 6.8, text: c.labels.sheetCode, size: 2.3, anchor: "middle", fill: GREY });
}

function headerA4(p: Primitive[], c: SheetContent) {
  const L = c.labels;
  p.push({ t: "text", x: 40, y: 17.2, text: "ZerdeliGrade", size: 5, weight: "bold" });
  p.push({ t: "text", x: 80, y: 17.2, text: L.title, size: 4.2, weight: "bold" });
  const fields: Array<[string, string | undefined, number]> = [
    [L.test, [c.testTitle, c.subjectName].filter(Boolean).join(" · "), 28],
    [L.studentName, c.studentName, 37],
    [L.studentCode, c.studentCode, 46],
    [L.className, c.className, 55],
    [L.date, undefined, 64],
  ];
  for (const [label, value, y] of fields) {
    p.push({ t: "text", x: 15, y, text: label, size: 2.8, fill: "#333333" });
    p.push({ t: "line", x1: 52, y1: y + 1, x2: 155, y2: y + 1, stroke: LIGHT, sw: 0.25 });
    if (value) p.push({ t: "text", x: 53, y: y - 0.3, text: truncate(value, 60), size: 3.4, weight: "bold" });
  }
  if (c.centerName) {
    p.push({ t: "text", x: 155, y: 70, text: truncate(`${L.center}: ${c.centerName}`, 70), size: 2.4, anchor: "end", fill: GREY });
  }
  p.push({ t: "rect", x: 15, y: 72, w: 180, h: 12, stroke: LIGHT, sw: 0.25, rx: 1.5 });
  p.push({ t: "text", x: 18, y: 76.3, text: L.instructionsTitle, size: 2.7, weight: "bold" });
  L.instructions.slice(0, 2).forEach((line, i) => {
    p.push({ t: "text", x: 18, y: 79.6 + i * 3.1, text: truncate(line, 95), size: 2.4, fill: "#333333" });
  });
  examples(p, L, 154, 75.5);
  if (c.hasTrueFalse) {
    p.push({ t: "text", x: 192, y: 81.3, text: truncate(L.trueFalseNote, 30), size: 2.3, anchor: "end", fill: "#333333" });
  }
}

/** Compact header for the A5 half-sheet (same information, smaller type). */
function headerA5(p: Primitive[], c: SheetContent) {
  const L = c.labels;
  p.push({ t: "text", x: 35, y: 13.6, text: "ZerdeliGrade", size: 4, weight: "bold" });
  p.push({ t: "text", x: 66, y: 13.6, text: truncate(L.title, 24), size: 3.2, weight: "bold" });
  const fields: Array<[string, string | undefined, number]> = [
    [L.test, [c.testTitle, c.subjectName].filter(Boolean).join(" · "), 24],
    [L.studentName, c.studentName, 31],
    [L.studentCode, c.studentCode, 38],
    [L.className, c.className, 45],
    [L.date, undefined, 52],
  ];
  for (const [label, value, y] of fields) {
    p.push({ t: "text", x: 8, y, text: truncate(label, 18), size: 2.3, fill: "#333333" });
    p.push({ t: "line", x1: 32, y1: y + 0.9, x2: 100, y2: y + 0.9, stroke: LIGHT, sw: 0.25 });
    if (value) p.push({ t: "text", x: 33, y: y - 0.3, text: truncate(value, 40), size: 2.9, weight: "bold" });
  }
  p.push({ t: "text", x: 8, y: 58.5, text: truncate(L.instructions[0] ?? "", 80), size: 2.2, fill: "#333333" });
  if (c.hasTrueFalse) p.push({ t: "text", x: 8, y: 62, text: truncate(L.trueFalseNote, 60), size: 2.2, fill: "#333333" });
  examples(p, L, 122, 55);
}

export function buildSheetDrawing(c: SheetContent): Primitive[] {
  const p: Primitive[] = [];
  const geo = c.layout.geo;
  const GRID = geo.grid;
  const L = c.labels;

  // White page background (so rasterized output has no transparency).
  p.push({ t: "rect", x: 0, y: 0, w: geo.page.width, h: geo.page.height, fill: "#FFFFFF" });

  // Corner markers + orientation bar.
  for (const m of Object.values(geo.markers)) {
    p.push({ t: "rect", x: m.x - MARKER_SIZE / 2, y: m.y - MARKER_SIZE / 2, w: MARKER_SIZE, h: MARKER_SIZE, fill: INK });
  }
  const bar = geo.orientationBar;
  p.push({ t: "rect", x: bar.x, y: bar.y, w: bar.w, h: bar.h, fill: INK });

  qrBlock(p, c, geo);
  if (geo.format === "a5") headerA5(p, c);
  else headerA4(p, c);

  // Column headers.
  for (let col = 0; col < c.layout.columns; col++) {
    const inColumn = c.layout.questions.filter((q) => q.column === col);
    const widest = inColumn.reduce((a, q) => (q.bubbles.length > a.bubbles.length ? q : a), inColumn[0]!);
    for (const b of widest.bubbles) {
      p.push({ t: "text", x: b.cx, y: GRID.top - GRID.headerOffset, text: b.label, size: 2.6, weight: "bold", anchor: "middle", fill: "#555555" });
    }
  }

  // Bubbles.
  for (const q of c.layout.questions) {
    if (q.row % 5 === 0 && q.row > 0) {
      const x0 = GRID.left + q.column * GRID.columnWidth + 2;
      p.push({ t: "line", x1: x0, y1: q.numberY - GRID.rowPitch / 2, x2: x0 + 39, y2: q.numberY - GRID.rowPitch / 2, stroke: "#E2E4E8", sw: 0.2 });
    }
    p.push({ t: "text", x: q.numberX, y: q.numberY + 1.1, text: String(q.position), size: 3, weight: "bold", anchor: "end" });
    const filled = new Set(c.fills?.[q.position] ?? []);
    for (const b of q.bubbles) {
      if (filled.has(b.label)) {
        p.push({ t: "circle", cx: b.cx, cy: b.cy, r: b.r - 0.15, fill: "#1A1A1A" });
      } else {
        p.push({ t: "circle", cx: b.cx, cy: b.cy, r: b.r, stroke: INK, sw: 0.3, fill: "#FFFFFF" });
        p.push({ t: "text", x: b.cx, y: b.cy + 0.85, text: b.label, size: 2.3, anchor: "middle", fill: LIGHT });
      }
    }
  }

  const footerY = geo.format === "a5" ? geo.page.height - 2.5 : 291;
  p.push({ t: "text", x: geo.page.width / 2, y: footerY, text: truncate(L.footer, geo.format === "a5" ? 90 : 140), size: geo.format === "a5" ? 2 : 2.3, anchor: "middle", fill: GREY });
  return p;
}
