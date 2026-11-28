import type { NextConfig } from "next";

/** Security headers on every page: no framing (clickjacking), no type sniffing, no camera/microphone/location. */
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  // cacheComponents / partialPrefetching are left off for the MVP: almost every
  // page shows per-school, per-user data, and cached output must never be
  // shared between schools. Revisit once tenant isolation is proven.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
