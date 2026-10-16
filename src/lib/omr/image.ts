import "server-only";
import sharp from "sharp";
import type { GrayImage } from "./recognize";

export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AcceptedImageType = (typeof ACCEPTED_IMAGE_TYPES)[number];
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

/** Detects the real image type from magic bytes (never trust the client's MIME type). */
export function sniffImageType(buf: Uint8Array): AcceptedImageType | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (
    buf.length >= 12 &&
    String.fromCharCode(...buf.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...buf.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/**
 * Decodes a photo, applies its EXIF orientation, downsizes to at most
 * `maxSide` pixels and converts to 8-bit grayscale for the recognizer.
 */
export async function loadGrayImage(input: Buffer | Uint8Array, maxSide = 2200): Promise<GrayImage> {
  const { data, info } = await sharp(input, { failOn: "error", limitInputPixels: 80_000_000 })
    .rotate()
    .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const gray = info.channels === 1 ? new Uint8Array(data) : new Uint8Array(data).filter((_, i) => i % info.channels === 0);
  return { width: info.width, height: info.height, data: gray };
}
