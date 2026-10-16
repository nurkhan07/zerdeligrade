import type { NextRequest } from "next/server";

/**
 * The origin the browser actually used (e.g. http://192.168.1.68:3000 on a
 * phone, https://zerdeligrade.vercel.app in production). request.url can
 * contain the server's bind address (0.0.0.0) when the dev server listens on
 * all interfaces, so redirects must not be built from it.
 */
export function requestOrigin(request: NextRequest): string {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host || !/^[A-Za-z0-9.\-:[\]]+$/.test(host)) return request.nextUrl.origin;
  const proto = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  return `${proto === "https" ? "https" : "http"}://${host}`;
}
