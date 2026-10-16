/**
 * Optical mark recognition for ZerdeliGrade answer sheets.
 *
 * Pipeline (all pure TypeScript, operates on an 8-bit grayscale image):
 *  1. Adaptive threshold (local mean via integral image) -> robust to uneven
 *     lighting and shadows.
 *  2. Connected components -> candidates for the four solid corner markers.
 *  3. Pick the four candidates of similar size spanning the largest convex
 *     quadrilateral, and compute a perspective transform (homography) from
 *     sheet millimetres to image pixels. This corrects rotation, skew and
 *     perspective in one step.
 *  4. Try the 4 possible 90° orientations; the printed orientation bar next to
 *     the top-left marker decides which one is right.
 *  5. Measure ink level (paper-normalised darkness) inside every bubble and
 *     classify each question as ok / blank / multiple / uncertain with a
 *     confidence value.
 *  6. Decode the QR code (rectified crop first, whole image as fallback).
 *
 * Nothing here ever "guesses" silently: ambiguous marks are reported as
 * `uncertain` or `multiple` and must be resolved by a teacher.
 */
import jsQR from "jsqr";
import { applyHomography, computeHomography, distance, isConvex, polygonArea, type Homography, type Point } from "./geometry";
import {
  CORNER_ORDER,
  GEOMETRY,
  MARKER_SIZE,
  SHEET_FORMATS,
  buildLayout,
  type OptionLabel,
  type SheetFormat,
  type SheetGeometry,
} from "./layout";
import { parseSheetPayload } from "./sheet-code";

export interface GrayImage {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

export type RecognitionErrorCode =
  | "image_too_small"
  | "too_dark"
  | "low_contrast"
  | "markers_not_found"
  | "orientation_unknown"
  | "misaligned";

export type SheetWarningCode = "blurry" | "very_blurry" | "dark" | "perspective" | "qr_unreadable";

export interface SheetWarning {
  code: SheetWarningCode;
  blocking: boolean;
}

export interface SheetQuality {
  width: number;
  height: number;
  brightness: number;
  contrast: number;
  edgeWidthMm: number;
  rotation: 0 | 90 | 180 | 270;
  perspective: number;
  alignment?: number;
}

export type AnswerStatus = "ok" | "blank" | "multiple" | "uncertain";

export interface RecognizedAnswer {
  position: number;
  /** Labels whose ink level is above the "filled" threshold. */
  detected: OptionLabel[];
  /** Best single answer: set for ok, and for uncertain when one option clearly leads. */
  chosen: OptionLabel | null;
  status: AnswerStatus;
  confidence: number;
  fill: Partial<Record<OptionLabel, number>>;
}

export interface LocatedSheet {
  format: SheetFormat;
  geo: SheetGeometry;
  /** Other plausible formats (used when the QR code could not be read). */
  alternatives?: LocatedSheet[];
  image: GrayImage;
  H: Homography;
  black: number;
  paper: number;
  quality: SheetQuality;
  warnings: SheetWarning[];
  sheetCode: string | null;
}

export type LocateResult = { ok: true; sheet: LocatedSheet } | { ok: false; error: RecognitionErrorCode; quality?: Partial<SheetQuality> };

export type ReadResult =
  | { ok: true; answers: RecognizedAnswer[]; quality: SheetQuality; warnings: SheetWarning[] }
  | { ok: false; error: RecognitionErrorCode; quality?: Partial<SheetQuality> };

export const THRESHOLDS = {
  /** Mean darkness inside a bubble at/above which it counts as filled. */
  filled: 0.5,
  /** At/below this the bubble is clearly empty. Between the two = uncertain. */
  empty: 0.28,
  /** A single filled answer must lead the runner-up by at least this much. */
  minMargin: 0.25,
  /** Minimum outline-vs-background contrast proving the grid is registered. */
  minAlignment: 0.06,
} as const;

// ---------------------------------------------------------------------------
// Pixel helpers
// ---------------------------------------------------------------------------

function sample(img: GrayImage, x: number, y: number): number {
  const { width: w, height: h, data } = img;
  if (x < 0 || y < 0 || x > w - 1 || y > h - 1) return 255;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, w - 1);
  const y1 = Math.min(y0 + 1, h - 1);
  const fx = x - x0;
  const fy = y - y0;
  const a = data[y0 * w + x0]!;
  const b = data[y0 * w + x1]!;
  const c = data[y1 * w + x0]!;
  const d = data[y1 * w + x1]!;
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

function sampleMm(img: GrayImage, H: Homography, x: number, y: number): number {
  const p = applyHomography(H, { x, y });
  return sample(img, p.x, p.y);
}

function darkness(v: number, white: number, black: number): number {
  const span = Math.max(white - black, 1);
  return Math.min(1, Math.max(0, (white - v) / span));
}

function percentile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]!;
}

// ---------------------------------------------------------------------------
// Marker detection
// ---------------------------------------------------------------------------

interface Blob {
  area: number;
  cx: number;
  cy: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function darkMask(img: GrayImage): Uint8Array {
  const { width: w, height: h, data } = img;
  // Integral image for O(1) local means.
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    for (let x = 0; x < w; x++) {
      rowSum += data[y * w + x]!;
      integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1]! + rowSum;
    }
  }
  const half = Math.max(8, Math.round(Math.min(w, h) / 16));
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - half);
    const y1 = Math.min(h, y + half + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - half);
      const x1 = Math.min(w, x + half + 1);
      const sum =
        integral[y1 * (w + 1) + x1]! - integral[y0 * (w + 1) + x1]! - integral[y1 * (w + 1) + x0]! + integral[y0 * (w + 1) + x0]!;
      const mean = sum / ((x1 - x0) * (y1 - y0));
      if (data[y * w + x]! < mean * 0.72) mask[y * w + x] = 1;
    }
  }
  return mask;
}

function findBlobs(mask: Uint8Array, w: number, h: number, minArea: number): Blob[] {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const blobs: Blob[] = [];
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || seen[start]) continue;
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    let area = 0;
    let sx = 0;
    let sy = 0;
    let minX = w;
    let maxX = 0;
    let minY = h;
    let maxY = 0;
    while (top > 0) {
      const i = stack[--top]!;
      const x = i % w;
      const y = (i - x) / w;
      area++;
      sx += x;
      sy += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x > 0 && mask[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack[top++] = i - 1; }
      if (x < w - 1 && mask[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack[top++] = i + 1; }
      if (y > 0 && mask[i - w] && !seen[i - w]) { seen[i - w] = 1; stack[top++] = i - w; }
      if (y < h - 1 && mask[i + w] && !seen[i + w]) { seen[i + w] = 1; stack[top++] = i + w; }
    }
    if (area >= minArea) blobs.push({ area, cx: sx / area, cy: sy / area, minX, maxX, minY, maxY });
  }
  return blobs;
}

function markerCandidates(img: GrayImage, mask: Uint8Array): Blob[] {
  const { width: w, height: h } = img;
  const short = Math.min(w, h);
  const minSide = short * 0.012;
  const maxSide = short * 0.09;
  return findBlobs(mask, w, h, Math.round(minSide * minSide)).filter((b) => {
    const bw = b.maxX - b.minX + 1;
    const bh = b.maxY - b.minY + 1;
    if (bw > maxSide * 1.5 || bh > maxSide * 1.5) return false;
    if (b.area > maxSide * maxSide) return false;
    const aspect = bw / bh;
    if (aspect < 0.5 || aspect > 2) return false;
    if (b.area / (bw * bh) < 0.45) return false;
    // Solid core: the central region must be (almost) entirely dark.
    const r = Math.max(1, Math.round(Math.sqrt(b.area) * 0.25));
    let dark = 0;
    let total = 0;
    for (let y = Math.round(b.cy) - r; y <= Math.round(b.cy) + r; y++) {
      for (let x = Math.round(b.cx) - r; x <= Math.round(b.cx) + r; x++) {
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        total++;
        dark += mask[y * w + x]!;
      }
    }
    return total > 0 && dark / total >= 0.9;
  });
}

/** Orders 4 points clockwise (image coordinates, y down) starting from the top-left-most. */
function orderClockwise(pts: Point[]): Point[] {
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const sorted = [...pts].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  let first = 0;
  sorted.forEach((p, i) => {
    if (p.x + p.y < sorted[first]!.x + sorted[first]!.y) first = i;
  });
  return [...sorted.slice(first), ...sorted.slice(0, first)];
}

function chooseMarkers(cands: Blob[], w: number, h: number, geos: SheetGeometry[]): Point[] | null {
  const top = [...cands].sort((a, b) => b.area - a.area).slice(0, 20);
  let best: { pts: Point[]; score: number } | null = null;
  const n = top.length;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++) {
          const set = [top[a]!, top[b]!, top[c]!, top[d]!];
          const areas = set.map((s) => s.area);
          // Strong perspective can make near markers ~3x larger (in area) than far ones.
          if (Math.max(...areas) / Math.min(...areas) > 4) continue;
          const pts = orderClockwise(set.map((s) => ({ x: s.cx, y: s.cy })));
          if (!isConvex(pts)) continue;
          const area = polygonArea(pts);
          if (area < 0.12 * w * h) continue;
          if (!geos.some((g) => consistentWithSheet(pts, set, g))) continue;
          if (!best || area > best.score) best = { pts, score: area };
        }
  return best?.pts ?? null;
}

/**
 * Rejects quadrilaterals that cannot be the four sheet markers: the quad must
 * have roughly the sheet's aspect ratio (in either orientation), and each
 * blob's size must match the 8 mm marker size implied by the quad's scale at
 * that corner. This stops filled bubbles standing in for a cut-off marker.
 */
function consistentWithSheet(pts: Point[], blobs: Blob[], geo: SheetGeometry): boolean {
  const MARKERS = geo.markers;
  const sideW = (distance(pts[0]!, pts[1]!) + distance(pts[3]!, pts[2]!)) / 2;
  const sideH = (distance(pts[0]!, pts[3]!) + distance(pts[1]!, pts[2]!)) / 2;
  const expected = (MARKERS.tr.x - MARKERS.tl.x) / (MARKERS.bl.y - MARKERS.tl.y);
  const ratio = sideW / sideH;
  const aspectOk = Math.abs(Math.log(ratio / expected)) < 0.45 || Math.abs(Math.log(ratio * expected)) < 0.45;
  if (!aspectOk) return false;
  const markerSpanMm = (MARKERS.tr.x - MARKERS.tl.x + (MARKERS.bl.y - MARKERS.tl.y)) / 2;
  for (let i = 0; i < 4; i++) {
    const p = pts[i]!;
    const blob = blobs.find((b) => Math.abs(b.cx - p.x) < 1e-6 && Math.abs(b.cy - p.y) < 1e-6)!;
    const adjacent = (distance(p, pts[(i + 1) % 4]!) + distance(p, pts[(i + 3) % 4]!)) / 2;
    const expectedSide = (adjacent / markerSpanMm) * MARKER_SIZE;
    const k = Math.sqrt(blob.area) / expectedSide;
    if (k < 0.72 || k > 1.45) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Locate the sheet
// ---------------------------------------------------------------------------

const sheetCorners = (geo: SheetGeometry): Point[] => CORNER_ORDER.map((c) => geo.markers[c]);

function meanDarknessRect(img: GrayImage, H: Homography, x: number, y: number, w: number, h: number, white: number, black: number) {
  let sum = 0;
  let n = 0;
  for (let yy = y; yy <= y + h + 1e-9; yy += h / 6) {
    for (let xx = x; xx <= x + w + 1e-9; xx += w / 10) {
      sum += darkness(sampleMm(img, H, xx, yy), white, black);
      n++;
    }
  }
  return sum / n;
}

/**
 * Under a candidate transform every marker must be a solid square surrounded
 * by a white quiet zone. Bubbles or text mistaken for markers fail this.
 */
function markersVerified(img: GrayImage, H: Homography, black: number, geo: SheetGeometry): boolean {
  for (const m of Object.values(geo.markers)) {
    const ring: number[] = [];
    for (let t = -6; t <= 6; t += 1) {
      for (const [x, y] of [[m.x + t, m.y - 6.5], [m.x + t, m.y + 6.5], [m.x - 6.5, m.y + t], [m.x + 6.5, m.y + t]] as const) {
        ring.push(sampleMm(img, H, x, y));
      }
    }
    // Local paper level, so shadows across the page do not matter.
    const white = percentile(ring, 0.8);
    if (white - black < 25) return false;
    let inner = 0;
    let n = 0;
    for (let dy = -3; dy <= 3; dy += 1) {
      for (let dx = -3; dx <= 3; dx += 1) {
        inner += darkness(sampleMm(img, H, m.x + dx, m.y + dy), white, black);
        n++;
      }
    }
    if (inner / n < 0.75) return false;
    const darkRing = ring.filter((v) => darkness(v, white, black) > 0.5).length / ring.length;
    if (darkRing > 0.2) return false;
  }
  return true;
}

/** Average 20%–80% edge width (mm) across the marker edges: a scale-independent blur measure. */
function edgeWidthMm(img: GrayImage, H: Homography, white: number, black: number, geo: SheetGeometry): number {
  const widths: number[] = [];
  const half = MARKER_SIZE / 2;
  for (const m of Object.values(geo.markers)) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const profile: number[] = [];
      for (let t = half - 2.5; t <= half + 2.5; t += 0.1) {
        profile.push(darkness(sampleMm(img, H, m.x + dx * t, m.y + dy * t), white, black));
      }
      const i80 = profile.findIndex((v) => v < 0.8);
      const i20 = profile.findIndex((v) => v < 0.2);
      if (i80 >= 0 && i20 >= i80) widths.push((i20 - i80) * 0.1);
    }
  }
  return widths.length ? percentile(widths, 0.5) : 99;
}

function decodeQr(img: GrayImage, H: Homography, geo: SheetGeometry): string | null {
  const QR = geo.qr;
  const margin = 2;
  const pxPerMm = 8;
  const sizeMm = QR.size + margin * 2;
  const n = Math.round(sizeMm * pxPerMm);
  const rgba = new Uint8ClampedArray(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const v = sampleMm(img, H, QR.x - margin + x / pxPerMm, QR.y - margin + y / pxPerMm);
      const i = (y * n + x) * 4;
      rgba[i] = rgba[i + 1] = rgba[i + 2] = v;
      rgba[i + 3] = 255;
    }
  }
  const hit = jsQR(rgba, n, n, { inversionAttempts: "dontInvert" });
  return hit ? parseSheetPayload(hit.data) : null;
}

function decodeQrWholeImage(img: GrayImage): string | null {
  const scale = Math.min(1, 1400 / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = sample(img, x / scale, y / scale);
      const i = (y * w + x) * 4;
      rgba[i] = rgba[i + 1] = rgba[i + 2] = v;
      rgba[i + 3] = 255;
    }
  }
  const hit = jsQR(rgba, w, h, { inversionAttempts: "attemptBoth" });
  return hit ? parseSheetPayload(hit.data) : null;
}

/**
 * Finds the sheet in the photo. The four markers are detected once; then each
 * paper format is tried. A decoded QR code settles the format; otherwise the
 * candidates are returned (best first) and the caller confirms with readAnswers.
 */
export function locateSheet(img: GrayImage, formats: readonly SheetFormat[] = SHEET_FORMATS): LocateResult {
  const { width: w, height: h, data } = img;
  if (Math.min(w, h) < 600) return { ok: false, error: "image_too_small", quality: { width: w, height: h } };

  let total = 0;
  for (let i = 0; i < data.length; i += 7) total += data[i]!;
  const brightness = total / Math.ceil(data.length / 7);
  if (brightness < 35) return { ok: false, error: "too_dark", quality: { width: w, height: h, brightness } };

  const geos = formats.map((f) => GEOMETRY[f]);
  const corners = chooseMarkers(markerCandidates(img, darkMask(img)), w, h, geos);
  if (!corners) return { ok: false, error: "markers_not_found", quality: { width: w, height: h, brightness } };

  let failure: LocateResult | null = null;
  const found: Array<{ sheet: LocatedSheet; bar: number }> = [];
  for (const geo of geos) {
    const r = locateWithGeometry(img, corners, geo, brightness);
    if ("error" in r) {
      failure ??= { ok: false, error: r.error, quality: r.quality };
      continue;
    }
    if (r.confirmed) return { ok: true, sheet: r.sheet };
    found.push(r);
  }
  if (!found.length) return failure ?? { ok: false, error: "markers_not_found", quality: { width: w, height: h, brightness } };
  found.sort((a, b) => b.bar - a.bar);
  const [first, ...rest] = found;
  return { ok: true, sheet: { ...first!.sheet, alternatives: rest.map((x) => x.sheet) } };
}

function locateWithGeometry(
  img: GrayImage,
  corners: Point[],
  geo: SheetGeometry,
  brightness: number,
): { sheet: LocatedSheet; bar: number; confirmed: boolean } | { error: RecognitionErrorCode; quality: Partial<SheetQuality> } {
  const { width: w, height: h } = img;
  const MARKERS = geo.markers;
  const PAGE = geo.page;
  const ORIENTATION_BAR = geo.orientationBar;
  const SHEET_CORNERS = sheetCorners(geo);
  const spanRatio = (MARKERS.tr.x - MARKERS.tl.x) / (MARKERS.bl.y - MARKERS.tl.y);
  // Ink and paper reference levels.
  const H0 = computeHomography(SHEET_CORNERS, corners);
  const blackSamples: number[] = [];
  for (const m of Object.values(MARKERS)) {
    for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) blackSamples.push(sampleMm(img, H0, m.x + dx, m.y + dy));
  }
  const paperSamples: number[] = [];
  for (let y = 25; y < PAGE.height - 25; y += 4) for (let x = 20; x < PAGE.width - 20; x += 4) paperSamples.push(sampleMm(img, H0, x, y));
  const black = percentile(blackSamples, 0.5);
  const paper = percentile(paperSamples, 0.85);
  const contrast = paper - black;
  if (contrast < 25) return { error: "too_dark", quality: { width: w, height: h, brightness, contrast } };
  if (contrast < 45) return { error: "low_contrast", quality: { width: w, height: h, brightness, contrast } };

  // Orientation: try each cyclic assignment of image corners to sheet corners.
  const options = [0, 1, 2, 3].map((rot) => {
    const imgPts = [0, 1, 2, 3].map((i) => corners[(i + rot) % 4]!);
    const H = computeHomography(SHEET_CORNERS, imgPts);
    const bar = meanDarknessRect(img, H, ORIENTATION_BAR.x + 1, ORIENTATION_BAR.y + 1, ORIENTATION_BAR.w - 2, ORIENTATION_BAR.h - 2, paper, black);
    // The long sheet side must map to the long image side.
    const topLen = (distance(imgPts[0]!, imgPts[1]!) + distance(imgPts[3]!, imgPts[2]!)) / 2;
    const sideLen = (distance(imgPts[0]!, imgPts[3]!) + distance(imgPts[1]!, imgPts[2]!)) / 2;
    const aspectError = Math.abs(Math.log(topLen / sideLen / spanRatio));
    return { rot, H, bar, aspectError, imgPts };
  });
  const viable = options
    .filter((o) => o.aspectError < 0.45 && markersVerified(img, o.H, black, geo))
    .sort((a, b) => b.bar - a.bar);
  if (viable.length === 0) return { error: "markers_not_found", quality: { width: w, height: h, brightness, contrast } };
  const best = viable[0];
  const runnerUp = viable[1];
  if (!best || best.bar < 0.5 || (runnerUp && runnerUp.bar > best.bar - 0.3)) {
    return { error: "orientation_unknown", quality: { width: w, height: h, brightness, contrast } };
  }

  const H = best.H;
  const p = best.imgPts;
  const perspective = Math.max(
    distance(p[0]!, p[1]!) / distance(p[3]!, p[2]!),
    distance(p[3]!, p[2]!) / distance(p[0]!, p[1]!),
    distance(p[0]!, p[3]!) / distance(p[1]!, p[2]!),
    distance(p[1]!, p[2]!) / distance(p[0]!, p[3]!),
  );
  const edge = edgeWidthMm(img, H, paper, black, geo);
  const rotation = (best.rot * 90) as 0 | 90 | 180 | 270;
  const quality: SheetQuality = {
    width: w,
    height: h,
    brightness: Math.round(brightness),
    contrast: Math.round(contrast),
    edgeWidthMm: Number(edge.toFixed(2)),
    rotation,
    perspective: Number(perspective.toFixed(3)),
  };

  const warnings: SheetWarning[] = [];
  if (edge > 1.8) warnings.push({ code: "very_blurry", blocking: true });
  else if (edge > 1.0) warnings.push({ code: "blurry", blocking: false });
  if (paper < 110) warnings.push({ code: "dark", blocking: false });
  if (perspective > 1.5) warnings.push({ code: "perspective", blocking: false });

  // A QR read at this format's own QR position confirms the format.
  const qrAtPosition = decodeQr(img, H, geo);
  const sheetCode = qrAtPosition ?? decodeQrWholeImage(img);
  if (!sheetCode) warnings.push({ code: "qr_unreadable", blocking: false });

  return { sheet: { format: geo.format, geo, image: img, H, black, paper, quality, warnings, sheetCode }, bar: best.bar, confirmed: qrAtPosition !== null };
}

// ---------------------------------------------------------------------------
// Read answers
// ---------------------------------------------------------------------------

function circleSamples(img: GrayImage, H: Homography, cx: number, cy: number, r: number, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    out.push(sampleMm(img, H, cx + r * Math.cos(a), cy + r * Math.sin(a)));
  }
  return out;
}

function diskDarkness(img: GrayImage, H: Homography, cx: number, cy: number, r: number, white: number, black: number): number {
  let sum = 0;
  let n = 0;
  const step = r / 4;
  for (let dy = -r; dy <= r + 1e-9; dy += step) {
    for (let dx = -r; dx <= r + 1e-9; dx += step) {
      if (dx * dx + dy * dy > r * r) continue;
      sum += darkness(sampleMm(img, H, cx + dx, cy + dy), white, black);
      n++;
    }
  }
  return sum / n;
}

export function classifyQuestion(
  position: number,
  fills: Array<{ label: OptionLabel; level: number }>,
  t: typeof THRESHOLDS = THRESHOLDS,
): RecognizedAnswer {
  const fill = Object.fromEntries(fills.map((f) => [f.label, Number(f.level.toFixed(3))])) as Partial<Record<OptionLabel, number>>;
  const sorted = [...fills].sort((a, b) => b.level - a.level);
  const top = sorted[0]!;
  const second = sorted[1] ?? { label: top.label, level: 0 };
  const filled = fills.filter((f) => f.level >= t.filled).map((f) => f.label);
  const ambiguous = fills.filter((f) => f.level > t.empty && f.level < t.filled);
  const clamp = (v: number) => Number(Math.min(1, Math.max(0, v)).toFixed(3));

  if (filled.length > 1) {
    return { position, detected: filled, chosen: null, status: "multiple", confidence: clamp(Math.min(...filled.map((l) => fill[l]!)) ), fill };
  }
  if (filled.length === 1 && ambiguous.length === 0 && top.level - second.level >= t.minMargin) {
    return { position, detected: filled, chosen: top.label, status: "ok", confidence: clamp((top.level - second.level) / 0.6), fill };
  }
  if (filled.length === 0 && ambiguous.length === 0) {
    return { position, detected: [], chosen: null, status: "blank", confidence: clamp(1 - top.level / (t.empty * 2)), fill };
  }
  // Something is marked but not clearly: a faint fill, an erasure, or a weak second mark.
  const leader = filled.length === 1 ? top.label : null;
  return {
    position,
    detected: filled,
    chosen: leader,
    status: "uncertain",
    confidence: clamp(Math.abs(top.level - second.level) / 0.6 * 0.5),
    fill,
  };
}

/**
 * Real photos are not perfectly planar: the paper bows and phone lenses
 * distort, so the 4-marker homography can be ~1-2 mm off in the middle of the
 * sheet. For each question row we therefore search a small window around the
 * predicted position for the offset where the printed bubble outlines are
 * darkest relative to the paper just outside them, and read the marks there.
 */
const SEARCH_MM = 2;
function rowOffset(img: GrayImage, H: Homography, bubbles: Array<{ cx: number; cy: number; r: number }>, start: { dx: number; dy: number }) {
  const score = (dx: number, dy: number) => {
    let s = 0;
    for (const b of bubbles) {
      const on = circleSamples(img, H, b.cx + dx, b.cy + dy, b.r, 16);
      const off = circleSamples(img, H, b.cx + dx, b.cy + dy, b.r + 0.9, 16);
      for (let i = 0; i < 16; i++) s += off[i]! - on[i]!;
    }
    return s;
  };
  let best = { dx: start.dx, dy: start.dy, s: score(start.dx, start.dy) };
  for (const step of [0.4, 0.15]) {
    const cx = best.dx;
    const cy = best.dy;
    const span = step === 0.4 ? 1.2 : 0.3;
    for (let dy = cy - span; dy <= cy + span + 1e-9; dy += step) {
      for (let dx = cx - span; dx <= cx + span + 1e-9; dx += step) {
        if (Math.abs(dx) > SEARCH_MM || Math.abs(dy) > SEARCH_MM) continue;
        const v = score(dx, dy);
        if (v > best.s) best = { dx, dy, s: v };
      }
    }
  }
  return { dx: best.dx, dy: best.dy };
}

export function readAnswers(sheet: LocatedSheet, optionCounts: number[]): ReadResult {
  if (optionCounts.length > sheet.geo.maxQuestions) return { ok: false, error: "misaligned", quality: sheet.quality };
  const layout = buildLayout(optionCounts, sheet.format);
  const { image: img, H, black } = sheet;
  const answers: RecognizedAnswer[] = [];
  // Registration check per column: printed bubble outlines must be darker than
  // the paper just outside them. A wrong layout or misregistered grid fails here.
  const outline = new Array<number>(layout.columns).fill(0);
  const ring = new Array<number>(layout.columns).fill(0);
  const count = new Array<number>(layout.columns).fill(0);
  // Offsets change smoothly down a column, so each row starts from the previous one.
  const tracked = new Array<{ dx: number; dy: number }>(layout.columns).fill({ dx: 0, dy: 0 });

  for (const q of layout.questions) {
    const off = rowOffset(img, H, q.bubbles, tracked[q.column]!);
    tracked[q.column] = off;
    const fills = q.bubbles.map((b) => {
      const cx = b.cx + off.dx;
      const cy = b.cy + off.dy;
      const around = circleSamples(img, H, cx, cy, 3.1, 24);
      const white = Math.max(percentile(around, 0.6), black + 30);
      const level = diskDarkness(img, H, cx, cy, b.r * 0.62, white, black);
      const edge = circleSamples(img, H, cx, cy, b.r, 32).map((v) => darkness(v, white, black));
      outline[q.column]! += edge.reduce((s, v) => s + v, 0) / edge.length;
      ring[q.column]! += around.map((v) => darkness(v, white, black)).reduce((s, v) => s + v, 0) / around.length;
      count[q.column]!++;
      return { label: b.label, level };
    });
    answers.push(classifyQuestion(q.position, fills));
  }

  const alignment = Math.min(...outline.map((o, i) => (o - ring[i]!) / Math.max(1, count[i]!)));
  const quality = { ...sheet.quality, alignment: Number(alignment.toFixed(3)) };
  if (alignment < THRESHOLDS.minAlignment) return { ok: false, error: "misaligned", quality };
  return { ok: true, answers, quality, warnings: sheet.warnings };
}
