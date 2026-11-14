import { resolve } from "node:path";
import type { NextConfig } from "next";
import { createMDX } from "fumadocs-mdx/next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  headers: async () => [{ source: '/:path*', headers: [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Content-Security-Policy', value: "base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'" },
    { key: 'Referrer-Policy', value: 'no-referrer' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  ] }],
  // Use the compiler API supported by the pinned TypeScript 5.9 release.
  // The CLI subprocess returns empty captured output in this restricted environment.
  experimental: { useTypeScriptCli: false },
  cacheComponents: true,
  partialPrefetching: true,
  outputFileTracingRoot: resolve(process.cwd(), ".."),
  turbopack: {
    root: resolve(process.cwd(), ".."),
    rules: {
      // Reclassifying a CSS Module as plain CSS removes its class-name exports.
      // Only the two Tailwind entry stylesheets need this loader.
      "globals.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
      "docs.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

const withMDX = createMDX();

export default withMDX(nextConfig);
