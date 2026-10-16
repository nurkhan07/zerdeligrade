import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Dev only: lets phones on the same home/office Wi-Fi (192.168.x.x / 10.x.x.x)
  // load the development server. Has no effect on production builds.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*"],
  // sharp ships native binaries and must stay a runtime dependency of the server bundle.
  serverExternalPackages: ["sharp"],
  // The PDF route reads these fonts from disk at runtime; make sure Vercel bundles them.
  outputFileTracingIncludes: {
    "/api/answer-sheets/pdf": ["./assets/fonts/**"],
  },
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
