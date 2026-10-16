import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { Primitive } from "./drawing";

const MM = 72 / 25.4; // PDF points per millimetre

function color(hex: string | undefined) {
  const h = (hex ?? "#000000").replace("#", "");
  return rgb(parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255);
}

let fontCache: { regular: Uint8Array; bold: Uint8Array } | null = null;
async function loadFonts() {
  if (!fontCache) {
    const dir = path.join(process.cwd(), "assets", "fonts");
    const [regular, bold] = await Promise.all([
      readFile(path.join(dir, "IBMPlexSans-Regular.woff")),
      readFile(path.join(dir, "IBMPlexSans-Bold.woff")),
    ]);
    fontCache = { regular, bold };
  }
  return fontCache;
}

function drawPrimitives(page: PDFPage, prims: Primitive[], fonts: { regular: PDFFont; bold: PDFFont }, offsetX = 0) {
  const H = page.getHeight() / MM;
  const ox = offsetX * MM;
  for (const p of prims) {
    switch (p.t) {
      case "rect":
        page.drawRectangle({
          x: p.x * MM + ox,
          y: (H - p.y - p.h) * MM,
          width: p.w * MM,
          height: p.h * MM,
          color: p.fill && p.fill !== "none" ? color(p.fill) : undefined,
          borderColor: p.stroke ? color(p.stroke) : undefined,
          borderWidth: p.stroke ? (p.sw ?? 0.3) * MM : 0,
        });
        break;
      case "circle":
        page.drawCircle({
          x: p.cx * MM + ox,
          y: (H - p.cy) * MM,
          size: p.r * MM,
          color: p.fill && p.fill !== "none" ? color(p.fill) : undefined,
          borderColor: p.stroke ? color(p.stroke) : undefined,
          borderWidth: p.stroke ? (p.sw ?? 0.3) * MM : 0,
        });
        break;
      case "line":
        page.drawLine({
          start: { x: p.x1 * MM + ox, y: (H - p.y1) * MM },
          end: { x: p.x2 * MM + ox, y: (H - p.y2) * MM },
          thickness: p.sw * MM,
          color: color(p.stroke),
        });
        break;
      case "text": {
        const font = p.weight === "bold" ? fonts.bold : fonts.regular;
        const size = p.size * MM;
        const width = font.widthOfTextAtSize(p.text, size);
        const dx = p.anchor === "middle" ? width / 2 : p.anchor === "end" ? width : 0;
        page.drawText(p.text, { x: p.x * MM - dx + ox, y: (H - p.y) * MM, size, font, color: color(p.fill) });
        break;
      }
      case "qr": {
        const count = p.modules.length;
        const quiet = 2;
        const cell = p.size / (count + quiet * 2);
        page.drawRectangle({ x: p.x * MM + ox, y: (H - p.y - p.size) * MM, width: p.size * MM, height: p.size * MM, color: rgb(1, 1, 1) });
        p.modules.forEach((row, y) =>
          row.forEach((on, x) => {
            if (!on) return;
            page.drawRectangle({
              x: (p.x + (x + quiet) * cell) * MM + ox,
              y: (H - p.y - (y + quiet + 1) * cell) * MM,
              width: cell * MM + 0.05,
              height: cell * MM + 0.05,
              color: rgb(0, 0, 0),
            });
          }),
        );
        break;
      }
    }
  }
}

/**
 * A4 sheets: one per page. A5 sheets: two per A4 landscape page with a dashed
 * cut line in the middle (print at 100%, cut, hand out).
 */
export async function renderSheetsPdf(pages: Primitive[][], title: string, format: "a4" | "a5" = "a4"): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(title);
  doc.setProducer("ZerdeliGrade");
  doc.setCreator("ZerdeliGrade");
  const raw = await loadFonts();
  const fonts = {
    regular: await doc.embedFont(raw.regular, { subset: true }),
    bold: await doc.embedFont(raw.bold, { subset: true }),
  };
  if (format === "a5") {
    for (let i = 0; i < pages.length; i += 2) {
      const page = doc.addPage([297 * MM, 210 * MM]);
      drawPrimitives(page, pages[i]!, fonts, 0);
      if (pages[i + 1]) drawPrimitives(page, pages[i + 1]!, fonts, 148.5);
      page.drawLine({
        start: { x: 148.5 * MM, y: 0 },
        end: { x: 148.5 * MM, y: 210 * MM },
        thickness: 0.3,
        color: rgb(0.6, 0.6, 0.6),
        dashArray: [4, 4],
      });
    }
  } else {
    for (const prims of pages) {
      const page = doc.addPage([210 * MM, 297 * MM]);
      drawPrimitives(page, prims, fonts);
    }
  }
  return doc.save();
}
