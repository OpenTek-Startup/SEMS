import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
