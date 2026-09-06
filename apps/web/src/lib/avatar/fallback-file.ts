/**
 * Server-only: read a fallback SVG's text. Tries the public directory on disk
 * (dev, `next build`, tests) and then the deployment's own static URL (a
 * serverless function on Vercel does not carry `public/` in its bundle).
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fallbackSrc } from "./inputs";

export type ReadFallbackOptions = { publicDir?: string; origin?: string | null };

export async function readFallbackSvg(archetype: string, mood: string, opts: ReadFallbackOptions = {}): Promise<string | null> {
  const src = fallbackSrc(archetype, mood);
  const publicDir = opts.publicDir ?? path.join(process.cwd(), "public");
  // The public dir is resolved at runtime (tests inject one); traced explicitly
  // via next.config `outputFileTracingIncludes` for the OG route.
  const file = path.join(publicDir, src);
  try {
    return await fs.readFile(/* turbopackIgnore: true */ file, "utf8");
  } catch {
    /* not on disk here */
  }
  if (opts.origin) {
    try {
      const res = await fetch(new URL(src, opts.origin), { cache: "force-cache" });
      if (res.ok) return await res.text();
    } catch {
      /* fall through */
    }
  }
  return null;
}
