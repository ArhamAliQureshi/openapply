import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite (WASM + data files) and Playwright (browser binaries) must load from node_modules at runtime.
  serverExternalPackages: ["@electric-sql/pglite", "@electric-sql/pglite-pgvector", "playwright", "playwright-core", "sharp"],
  cacheComponents: true,
  partialPrefetching: true,
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
