import sharp from "sharp";
import { buildSheetDrawing, type SheetLabels } from "@/lib/omr/drawing";
import { buildLayout, type OptionLabel, type SheetFormat } from "@/lib/omr/layout";
import { renderSheetSvg } from "@/lib/omr/svg";
import { applyHomography, computeHomography, type Point } from "@/lib/omr/geometry";
import type { GrayImage } from "@/lib/omr/recognize";

export const labels: SheetLabels = {
  title: "Жауап парағы",
  studentName: "Аты-жөні",
  studentCode: "Оқушы коды",
  className: "Сынып",
  date: "Күні",
  test: "Тест",
  center: "Орталық",
  instructionsTitle: "Нұсқаулық",
  instructions: ["Қара немесе көк қаламмен дөңгелекті толық бояңыз.", "Әр сұраққа бір ғана жауап белгілеңіз."],
  correctExample: "Дұрыс",
  wrongExample: "Қате",
  trueFalseNote: "A = Иә, B = Жоқ",
  sheetCode: "Парақ коды",
  footer: "Парақты бүктемеңіз. Бұрыштардағы белгілердің жанына жазбаңыз.",
};

export interface Faint {
  position: number;
  label: OptionLabel;
  shade: string;
  radiusFactor?: number;
}

function toGray(data: Buffer, channels: number): Uint8Array {
  return channels === 1 ? new Uint8Array(data) : new Uint8Array(data).filter((_, i) => i % channels === 0);
}

export async function renderSheet(opts: {
  optionCounts: number[];
  sheetCode: string;
  fills: Record<number, OptionLabel[]>;
  faint?: Faint[];
  width?: number;
  format?: SheetFormat;
}): Promise<GrayImage> {
  const layout = buildLayout(opts.optionCounts, opts.format ?? "a4");
  let svg = renderSheetSvg(
    buildSheetDrawing({ layout, sheetCode: opts.sheetCode, labels, testTitle: "Алгебра", studentName: "Тест Оқушы", fills: opts.fills }),
    { fontFamily: "Arial" },
  );
  const extra = (opts.faint ?? [])
    .map((f) => {
      const b = layout.questions[f.position - 1]!.bubbles.find((x) => x.label === f.label)!;
      return `<circle cx="${b.cx}" cy="${b.cy}" r="${b.r * (f.radiusFactor ?? 0.85)}" fill="${f.shade}"/>`;
    })
    .join("");
  svg = svg.replace("</svg>", `${extra}</svg>`);
  // librsvg's effective DPI differs by platform, so normalise to a fixed pixel
  // width (~phone photo of a page, about 7.9 px/mm).
  const { data, info } = await sharp(Buffer.from(svg), { density: 300 })
    .flatten({ background: "#ffffff" })
    .resize({ width: opts.width ?? 1654 })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: toGray(data, info.channels) };
}

/** Projects the page onto a larger "desk" background with the given corner positions (fractions of canvas). */
export function warp(img: GrayImage, canvas: { w: number; h: number }, corners: Point[], background = 90): GrayImage {
  const src: Point[] = [
    { x: 0, y: 0 },
    { x: img.width, y: 0 },
    { x: img.width, y: img.height },
    { x: 0, y: img.height },
  ];
  const dst = corners.map((c) => ({ x: c.x * canvas.w, y: c.y * canvas.h }));
  const inv = computeHomography(dst, src);
  const out = new Uint8Array(canvas.w * canvas.h);
  const d = img.data;
  const w = img.width;
  for (let y = 0; y < canvas.h; y++) {
    for (let x = 0; x < canvas.w; x++) {
      const p = applyHomography(inv, { x, y });
      if (p.x < 0 || p.y < 0 || p.x >= img.width - 1 || p.y >= img.height - 1) {
        out[y * canvas.w + x] = background;
        continue;
      }
      const x0 = Math.floor(p.x);
      const y0 = Math.floor(p.y);
      const fx = p.x - x0;
      const fy = p.y - y0;
      const v =
        (d[y0 * w + x0]! * (1 - fx) + d[y0 * w + x0 + 1]! * fx) * (1 - fy) +
        (d[(y0 + 1) * w + x0]! * (1 - fx) + d[(y0 + 1) * w + x0 + 1]! * fx) * fy;
      out[y * canvas.w + x] = Math.round(v);
    }
  }
  return { width: canvas.w, height: canvas.h, data: out };
}

/** Uneven lighting (left-to-right shadow), global dimming and deterministic noise. */
export function degrade(img: GrayImage, opts: { gain?: number; shadow?: number; noise?: number; seed?: number }): GrayImage {
  const out = new Uint8Array(img.data.length);
  let s = opts.seed ?? 42;
  const rand = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff - 0.5;
  };
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const i = y * img.width + x;
      const light = (opts.gain ?? 1) * (1 - (opts.shadow ?? 0) * (x / img.width));
      const v = img.data[i]! * light + rand() * 2 * (opts.noise ?? 0);
      out[i] = Math.max(0, Math.min(255, Math.round(v)));
    }
  }
  return { width: img.width, height: img.height, data: out };
}

export async function rotate(img: GrayImage, degrees: number): Promise<GrayImage> {
  const { data, info } = await sharp(Buffer.from(img.data), { raw: { width: img.width, height: img.height, channels: 1 } })
    .rotate(degrees, { background: "#ffffff" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: toGray(data, info.channels) };
}

export async function blur(img: GrayImage, sigma: number): Promise<GrayImage> {
  const { data, info } = await sharp(Buffer.from(img.data), { raw: { width: img.width, height: img.height, channels: 1 } })
    .blur(sigma)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: toGray(data, info.channels) };
}

export async function toJpeg(img: GrayImage, quality = 80): Promise<Buffer> {
  return sharp(Buffer.from(img.data), { raw: { width: img.width, height: img.height, channels: 1 } }).jpeg({ quality }).toBuffer();
}

/** Paper bowing: the middle of the sheet is displaced relative to the corners (in pixels). */
export function bend(img: GrayImage, amplitudeX: number, amplitudeY: number): GrayImage {
  const { width: w, height: h, data } = img;
  const out = new Uint8Array(w * h).fill(255);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = Math.sin((Math.PI * x) / w) * Math.sin((Math.PI * y) / h);
      const sx = Math.round(x - amplitudeX * k);
      const sy = Math.round(y - amplitudeY * k);
      if (sx >= 0 && sy >= 0 && sx < w && sy < h) out[y * w + x] = data[sy * w + sx]!;
    }
  }
  return { width: w, height: h, data: out };
}
