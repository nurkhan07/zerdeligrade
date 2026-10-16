/**
 * End-to-end OMR tests on synthetic photos: the real printable sheet is
 * rendered (same SVG as print), then rotated, warped, darkened, blurred,
 * noised and JPEG-compressed before recognition.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { classifyQuestion, locateSheet, readAnswers, type GrayImage, type RecognizedAnswer } from "@/lib/omr/recognize";
import { loadGrayImage } from "@/lib/omr/image";
import type { OptionLabel } from "@/lib/omr/layout";
import { bend, blur, degrade, renderSheet, rotate, toJpeg, warp } from "./fixtures";

// 40 questions: A–E for 1–19, A–D for 21–39, true/false (A/B) every 10th.
const optionCounts = Array.from({ length: 40 }, (_, i) => ((i + 1) % 10 === 0 ? 2 : i < 20 ? 5 : 4));
const SHEET = "K7M2Q9RXT4";
const fills: Record<number, OptionLabel[]> = {};
const expected: Array<{ position: number; status: RecognizedAnswer["status"]; chosen: OptionLabel | null }> = [];
const labelsFor = (n: number) => (["A", "B", "C", "D", "E"] as OptionLabel[]).slice(0, n);
for (let p = 1; p <= 40; p++) {
  const opts = labelsFor(optionCounts[p - 1]!);
  if (p === 7 || p === 33) {
    expected.push({ position: p, status: "blank", chosen: null });
  } else if (p === 12 || p === 25) {
    fills[p] = [opts[0]!, opts[2]!];
    expected.push({ position: p, status: "multiple", chosen: null });
  } else {
    const label = opts[(p * 3) % opts.length]!;
    fills[p] = [label];
    expected.push({ position: p, status: "ok", chosen: label });
  }
}

function check(img: GrayImage) {
  const located = locateSheet(img);
  if (!located.ok) throw new Error(`locate failed: ${located.error} ${JSON.stringify(located.quality)}`);
  expect(located.sheet.sheetCode).toBe(SHEET);
  const read = readAnswers(located.sheet, optionCounts);
  if (!read.ok) throw new Error(`read failed: ${read.error} ${JSON.stringify(read.quality)}`);
  const got = read.answers.map((a) => ({ position: a.position, status: a.status, chosen: a.chosen }));
  expect(got).toEqual(expected);
  return { located: located.sheet, read };
}

let base: GrayImage;
beforeAll(async () => {
  base = await renderSheet({ optionCounts, sheetCode: SHEET, fills });
});

describe("OMR recognition", () => {
  it("reads a clean scan, including blank and multiple marks", () => {
    const { read } = check(base);
    expect(read.warnings.filter((w) => w.blocking)).toEqual([]);
    for (const a of read.answers.filter((x) => x.status === "ok")) expect(a.confidence).toBeGreaterThan(0.8);
  });

  it.each([90, 180, 270])("handles a photo rotated by %i degrees", async (deg) => {
    check(await rotate(base, deg));
  });

  it("handles a slightly tilted photo on a dark desk", async () => {
    const tilted = await rotate(base, 7);
    check(
      warp(tilted, { w: 1900, h: 2500 }, [
        { x: 0.08, y: 0.05 },
        { x: 0.93, y: 0.07 },
        { x: 0.95, y: 0.96 },
        { x: 0.05, y: 0.93 },
      ]),
    );
  });

  it("corrects strong perspective (phone held at an angle)", () => {
    const img = warp(base, { w: 1700, h: 2300 }, [
      { x: 0.2, y: 0.08 },
      { x: 0.82, y: 0.1 },
      { x: 0.97, y: 0.95 },
      { x: 0.03, y: 0.92 },
    ]);
    const { located } = check(img);
    expect(located.quality.perspective).toBeGreaterThan(1.2);
  });

  it("handles a bent sheet (middle shifted ~1.2 mm against the corners)", () => {
    // ~7.9 px/mm: 9 px ≈ 1.15 mm, the kind of bowing seen on real phone photos.
    check(bend(base, 7, 9));
  });

  it("handles a bent sheet combined with perspective and noise", () => {
    const bent = bend(base, -6, 8);
    check(degrade(warp(bent, { w: 1700, h: 2300 }, [{ x: 0.12, y: 0.06 }, { x: 0.88, y: 0.08 }, { x: 0.95, y: 0.95 }, { x: 0.05, y: 0.93 }]), { gain: 0.8, noise: 8 }));
  });

  it("handles low light with an uneven shadow and sensor noise", () => {
    check(degrade(base, { gain: 0.55, shadow: 0.45, noise: 18 }));
  });

  it("handles moderate blur", async () => {
    const { located } = check(await blur(base, 3));
    expect(located.quality.edgeWidthMm).toBeGreaterThan(0.2);
  });

  it("survives a JPEG round trip through the upload decoder", async () => {
    const jpeg = await toJpeg(degrade(base, { gain: 0.8, shadow: 0.2, noise: 6 }), 70);
    check(await loadGrayImage(jpeg));
  });

  it("reports faint marks as uncertain instead of guessing", async () => {
    const img = await renderSheet({
      optionCounts,
      sheetCode: SHEET,
      fills: { 1: ["A"] },
      faint: [
        { position: 2, label: "B", shade: "#A8A8A8" },
        { position: 3, label: "C", shade: "#B8B8B8", radiusFactor: 0.6 },
      ],
    });
    const located = locateSheet(img);
    if (!located.ok) throw new Error(located.error);
    const read = readAnswers(located.sheet, optionCounts);
    if (!read.ok) throw new Error(read.error);
    expect(read.answers[0]!.status).toBe("ok");
    expect(read.answers[1]!.status).toBe("uncertain");
    expect(read.answers[1]!.chosen).toBeNull();
    expect(["uncertain", "blank"]).toContain(read.answers[2]!.status);
    expect(read.answers[2]!.chosen).toBeNull();
  });

  it("fails with a clear error when a corner marker is cut off", () => {
    const rows = Math.round(base.height * 0.8);
    const r = locateSheet({ width: base.width, height: rows, data: base.data.slice(0, base.width * rows) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(["markers_not_found", "orientation_unknown"]).toContain(r.error);
  });

  it("rejects images that are too small or too dark", () => {
    expect(locateSheet({ width: 300, height: 400, data: new Uint8Array(300 * 400).fill(200) })).toMatchObject({
      ok: false,
      error: "image_too_small",
    });
    expect(locateSheet({ width: 1000, height: 1400, data: new Uint8Array(1000 * 1400).fill(10) })).toMatchObject({
      ok: false,
      error: "too_dark",
    });
  });

  it("does not find a sheet in a blank photo", () => {
    expect(locateSheet({ width: 1200, height: 1600, data: new Uint8Array(1200 * 1600).fill(200) })).toMatchObject({
      ok: false,
      error: "markers_not_found",
    });
  });

  it("detects a sheet read with the wrong layout", () => {
    const located = locateSheet(base);
    if (!located.ok) throw new Error(located.error);
    // Pretend the test has 120 questions: columns 2–4 do not exist on this sheet.
    const read = readAnswers(located.sheet, Array.from({ length: 120 }, () => 5));
    expect(read.ok).toBe(false);
  });
});

describe("A5 half-sheets", () => {
  // 40 questions max on A5: 2 columns x 20.
  const counts5 = Array.from({ length: 40 }, (_, i) => ((i + 1) % 10 === 0 ? 2 : 5));
  const fills5: Record<number, OptionLabel[]> = {};
  const exp5: Array<{ position: number; status: RecognizedAnswer["status"]; chosen: OptionLabel | null }> = [];
  for (let p = 1; p <= 40; p++) {
    const opts = (["A", "B", "C", "D", "E"] as OptionLabel[]).slice(0, counts5[p - 1]!);
    if (p === 4) {
      exp5.push({ position: p, status: "blank", chosen: null });
      continue;
    }
    const l = opts[(p * 2) % opts.length]!;
    fills5[p] = [l];
    exp5.push({ position: p, status: "ok", chosen: l });
  }
  const CODE5 = "A5TESTQ2W3";
  let a5: GrayImage;
  beforeAll(async () => {
    // An A5 sheet photographed alone: ~10.7 px/mm at 1580 px wide.
    a5 = await renderSheet({ optionCounts: counts5, sheetCode: CODE5, fills: fills5, format: "a5", width: 1580 });
  });
  function check5(img: GrayImage) {
    const located = locateSheet(img);
    if (!located.ok) throw new Error(`locate failed: ${located.error}`);
    expect(located.sheet.format).toBe("a5");
    expect(located.sheet.sheetCode).toBe(CODE5);
    const read = readAnswers(located.sheet, counts5);
    if (!read.ok) throw new Error(`read failed: ${read.error} ${JSON.stringify(read.quality)}`);
    expect(read.answers.map((a) => ({ position: a.position, status: a.status, chosen: a.chosen }))).toEqual(exp5);
  }
  it("reads a clean A5 sheet and identifies the format", () => check5(a5));
  it("reads a rotated A5 sheet", async () => check5(await rotate(a5, 90)));
  it("reads a bent A5 sheet on a desk with perspective", () =>
    check5(degrade(warp(bend(a5, 6, 8), { w: 1700, h: 2300 }, [{ x: 0.1, y: 0.07 }, { x: 0.9, y: 0.09 }, { x: 0.94, y: 0.94 }, { x: 0.05, y: 0.92 }]), { gain: 0.8, noise: 8 })));
  it("still recognises A4 sheets as A4", () => {
    const located = locateSheet(base);
    expect(located.ok && located.sheet.format).toBe("a4");
  });
  it("refuses an A5 sheet read as a test with more than 40 questions", () => {
    const located = locateSheet(a5);
    if (!located.ok) throw new Error(located.error);
    expect(readAnswers(located.sheet, Array.from({ length: 60 }, () => 5)).ok).toBe(false);
  });
});

describe("classifyQuestion", () => {
  const f = (levels: number[]) => levels.map((level, i) => ({ label: (["A", "B", "C", "D", "E"] as OptionLabel[])[i]!, level }));
  it("single clear mark", () => expect(classifyQuestion(1, f([0.05, 0.9, 0.06, 0.04]))).toMatchObject({ status: "ok", chosen: "B" }));
  it("blank", () => expect(classifyQuestion(1, f([0.05, 0.08, 0.06, 0.04]))).toMatchObject({ status: "blank", chosen: null }));
  it("multiple", () =>
    expect(classifyQuestion(1, f([0.85, 0.9, 0.06]))).toMatchObject({ status: "multiple", detected: ["A", "B"], chosen: null }));
  it("erased second mark makes the answer uncertain but keeps the leader", () =>
    expect(classifyQuestion(1, f([0.88, 0.4, 0.05]))).toMatchObject({ status: "uncertain", chosen: "A" }));
  it("faint only mark is uncertain with no chosen answer", () =>
    expect(classifyQuestion(1, f([0.05, 0.35, 0.05]))).toMatchObject({ status: "uncertain", chosen: null }));
});
