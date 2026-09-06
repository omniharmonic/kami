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
    // The summon flow renders the locked hard-rules block, and provisioning
    // renders the profile template, by reading them at run time. Without these
    // the files are absent from the serverless bundle and step 3 throws.
    "/summon/[id]/[step]": ["../../profiles/templates/SOUL.hard-rules.md"],
    "/api/admin/profiles": ["../../profiles/templates/*.md", "../../profiles/templates/*.tmpl"],
    // /connect renders the profile the operator is about to deploy, and the
    // bundle route zips it. Same run-time template reads as the summon step;
    // without these the download throws `template_missing` on Vercel only.
    "/e/[slug]/connect": ["../../profiles/templates/**"],
    "/api/entities/[slug]/connect/bundle": ["../../profiles/templates/**"],
    // The OG card draws the archetype × mood fallback SVG. 104 KB in total, and
    // reading it from disk is faster than the same-origin fetch it falls back to.
    "/api/og/[slug]": ["./public/rigs/fallback/*.svg"],
  },
  typedRoutes: false,
  poweredByHeader: false,
};

export default nextConfig;
