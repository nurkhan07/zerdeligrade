import type { Primitive } from "./drawing";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const n = (v: number) => Number(v.toFixed(3));

/** Renders sheet primitives to a standalone SVG document sized as A4 in mm. */
export function renderSheetSvg(prims: Primitive[], opts: { fontFamily?: string } = {}): string {
  const font = opts.fontFamily ?? "'IBM Plex Sans', Arial, sans-serif";
  // The first primitive is always the white page background, sized to the format.
  const bg = prims[0];
  const W = bg?.t === "rect" ? bg.w : 210;
  const Hh = bg?.t === "rect" ? bg.h : 297;
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${Hh}" width="${W}mm" height="${Hh}mm" font-family="${esc(font)}">`,
  ];
  for (const p of prims) {
    switch (p.t) {
      case "rect":
        out.push(
          `<rect x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}"${p.rx ? ` rx="${p.rx}"` : ""} fill="${p.fill ?? "none"}"${p.stroke ? ` stroke="${p.stroke}" stroke-width="${p.sw ?? 0.3}"` : ""}/>`,
        );
        break;
      case "circle":
        out.push(
          `<circle cx="${n(p.cx)}" cy="${n(p.cy)}" r="${n(p.r)}" fill="${p.fill ?? "none"}"${p.stroke ? ` stroke="${p.stroke}" stroke-width="${p.sw ?? 0.3}"` : ""}/>`,
        );
        break;
      case "line":
        out.push(`<line x1="${n(p.x1)}" y1="${n(p.y1)}" x2="${n(p.x2)}" y2="${n(p.y2)}" stroke="${p.stroke}" stroke-width="${p.sw}"/>`);
        break;
      case "text":
        out.push(
          `<text x="${n(p.x)}" y="${n(p.y)}" font-size="${p.size}"${p.weight === "bold" ? ' font-weight="700"' : ""}${p.anchor && p.anchor !== "start" ? ` text-anchor="${p.anchor}"` : ""} fill="${p.fill ?? "#000000"}">${esc(p.text)}</text>`,
        );
        break;
      case "qr": {
        const count = p.modules.length;
        const quiet = 2; // modules of quiet zone inside the box
        const cell = p.size / (count + quiet * 2);
        let d = "";
        p.modules.forEach((row, y) =>
          row.forEach((on, x) => {
            if (on) d += `M${n(p.x + (x + quiet) * cell)} ${n(p.y + (y + quiet) * cell)}h${n(cell)}v${n(cell)}h${n(-cell)}z`;
          }),
        );
        out.push(`<rect x="${n(p.x)}" y="${n(p.y)}" width="${n(p.size)}" height="${n(p.size)}" fill="#FFFFFF"/>`);
        out.push(`<path d="${d}" fill="#000000" shape-rendering="crispEdges"/>`);
        break;
      }
    }
  }
  out.push("</svg>");
  return out.join("");
}
