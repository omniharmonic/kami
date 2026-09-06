import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Node runtime everywhere (architecture §6); these drivers must not be bundled.
  serverExternalPackages: ["pg", "@electric-sql/pglite", "@neondatabase/serverless"],
  // The status fixture is read from disk in dev/preview when no R2 URL is set.
  outputFileTracingIncludes: {
    "/e/[slug]": ["./src/fixtures/status/**"],
    "/e/[slug]/chat": ["./src/fixtures/status/**"],
    "/e/[slug]/how-i-work": ["./src/fixtures/status/**"],
    "/": ["./src/fixtures/status/**"],
  },
  typedRoutes: false,
  poweredByHeader: false,
};

export default nextConfig;
