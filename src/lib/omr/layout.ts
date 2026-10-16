/**
 * Answer-sheet geometry, in millimetres, for each supported paper format.
 *
 * This file is the single contract between the printed sheet (SVG / PDF
 * renderers) and the scanner. Never change the geometry of an existing format:
 * sheets already printed keep it. Add a new format instead.
 *
 *  - a4: one sheet per A4 page, up to 120 questions (4 columns x 30)
 *  - a5: half of an A4 page (two per A4 landscape, cut in the middle),
 *        up to 40 questions (2 columns x 20). Same bubble size as A4.
 */

export const LAYOUT_VERSION = 1;

export const OPTION_LABELS = ["A", "B", "C", "D", "E"] as const;
export type OptionLabel = (typeof OPTION_LABELS)[number];

export const SHEET_FORMATS = ["a4", "a5"] as const;
export type SheetFormat = (typeof SHEET_FORMATS)[number];

export type Corner = "tl" | "tr" | "br" | "bl";
export const CORNER_ORDER: Corner[] = ["tl", "tr", "br", "bl"];
/** Solid black square fiducials, one per page corner (same size on every format). */
export const MARKER_SIZE = 8;

export interface SheetGeometry {
  format: SheetFormat;
  page: { width: number; height: number };
  markers: Record<Corner, { x: number; y: number }>;
  /** Solid bar next to the top-left marker: tells the scanner which way up the sheet is. */
  orientationBar: { x: number; y: number; w: number; h: number };
  qr: { x: number; y: number; size: number };
  grid: {
    top: number; // y of the first row's bubble centres
    rowPitch: number;
    left: number; // x of the first column's origin
    columnWidth: number;
    numberOffset: number; // right edge of the question number, from column origin
    firstBubbleOffset: number;
    bubblePitch: number;
    bubbleRadius: number;
    headerOffset: number; // option letters above the first row
    rowsPerColumn: number;
    maxColumns: number;
  };
  maxQuestions: number;
}

const BUBBLES = { numberOffset: 9, firstBubbleOffset: 14, bubblePitch: 6.2, bubbleRadius: 2.3, headerOffset: 5.2 } as const;

export const GEOMETRY: Record<SheetFormat, SheetGeometry> = {
  a4: {
    format: "a4",
    page: { width: 210, height: 297 },
    markers: { tl: { x: 15, y: 15 }, tr: { x: 195, y: 15 }, br: { x: 195, y: 282 }, bl: { x: 15, y: 282 } },
    orientationBar: { x: 24, y: 12.5, w: 12, h: 5 },
    qr: { x: 165, y: 23, size: 28 },
    grid: { top: 92, rowPitch: 6, left: 17, columnWidth: 45, rowsPerColumn: 30, maxColumns: 4, ...BUBBLES },
    maxQuestions: 120,
  },
  a5: {
    format: "a5",
    page: { width: 148, height: 210 },
    markers: { tl: { x: 12, y: 12 }, tr: { x: 136, y: 12 }, br: { x: 136, y: 198 }, bl: { x: 12, y: 198 } },
    orientationBar: { x: 20, y: 9.5, w: 12, h: 5 },
    qr: { x: 105, y: 20, size: 24 },
    grid: { top: 72, rowPitch: 6, left: 14, columnWidth: 62, rowsPerColumn: 20, maxColumns: 2, ...BUBBLES },
    maxQuestions: 40,
  },
};

// A4 aliases (kept for existing callers and tests).
export const PAGE = GEOMETRY.a4.page;
export const MARKERS = GEOMETRY.a4.markers;
export const ORIENTATION_BAR = GEOMETRY.a4.orientationBar;
export const QR = GEOMETRY.a4.qr;
export const GRID = GEOMETRY.a4.grid;
export const MAX_QUESTIONS = GEOMETRY.a4.maxQuestions;
export const ROWS_PER_COLUMN = GEOMETRY.a4.grid.rowsPerColumn;
export const MAX_COLUMNS = GEOMETRY.a4.grid.maxColumns;

export function isSheetFormat(v: unknown): v is SheetFormat {
  return v === "a4" || v === "a5";
}

export interface BubbleSpec {
  label: OptionLabel;
  cx: number;
  cy: number;
  r: number;
}

export interface QuestionSpec {
  position: number;
  column: number;
  row: number;
  numberX: number;
  numberY: number;
  bubbles: BubbleSpec[];
}

export interface SheetLayout {
  version: number;
  format: SheetFormat;
  geo: SheetGeometry;
  questionCount: number;
  columns: number;
  questions: QuestionSpec[];
}

/**
 * @param optionCounts number of answer options for each question, in order
 *   (2 for true/false, 2–5 for single choice). Its length is the question count.
 */
export function buildLayout(optionCounts: number[], format: SheetFormat = "a4"): SheetLayout {
  const geo = GEOMETRY[format];
  const g = geo.grid;
  const questionCount = optionCounts.length;
  if (questionCount < 1 || questionCount > geo.maxQuestions) {
    throw new RangeError(`questionCount must be 1..${geo.maxQuestions} for ${format}`);
  }
  const questions: QuestionSpec[] = optionCounts.map((count, i) => {
    if (!Number.isInteger(count) || count < 2 || count > OPTION_LABELS.length) {
      throw new RangeError(`question ${i + 1}: option count must be 2..5`);
    }
    const column = Math.floor(i / g.rowsPerColumn);
    const row = i % g.rowsPerColumn;
    const originX = g.left + column * g.columnWidth;
    const cy = g.top + row * g.rowPitch;
    return {
      position: i + 1,
      column,
      row,
      numberX: originX + g.numberOffset,
      numberY: cy,
      bubbles: OPTION_LABELS.slice(0, count).map((label, k) => ({
        label,
        cx: originX + g.firstBubbleOffset + k * g.bubblePitch,
        cy,
        r: g.bubbleRadius,
      })),
    };
  });
  return { version: LAYOUT_VERSION, format, geo, questionCount, columns: Math.ceil(questionCount / g.rowsPerColumn), questions };
}
