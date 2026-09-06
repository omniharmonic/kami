/**
 * Pure SVG helpers shared by the OG route and tests.
 *
 * The fallback SVGs colour themselves through CSS custom properties with
 * concrete fallbacks (`fill:var(--kami-accent,#2f6f8f)`) so an inlined copy
 * can be themed by the page. Rasterisers (resvg behind next/og) do not
 * understand `var()`, so the OG route resolves them to the fallback first.
 */

const VAR_WITH_FALLBACK = /var\(\s*--[\w-]+\s*,\s*([^()]+?)\s*\)/g;

export function resolveCssVars(svg: string): string {
  let out = svg;
  // nested fallbacks (var(--a, var(--b, #fff))) resolve in a couple of passes
  for (let i = 0; i < 3 && VAR_WITH_FALLBACK.test(out); i++) {
    VAR_WITH_FALLBACK.lastIndex = 0;
    out = out.replace(VAR_WITH_FALLBACK, "$1");
  }
  VAR_WITH_FALLBACK.lastIndex = 0;
  return out;
}

export function svgToDataUri(svg: string): string {
  const b64 =
    typeof Buffer !== "undefined"
      ? Buffer.from(svg, "utf8").toString("base64")
      : btoa(unescape(encodeURIComponent(svg)));
  return `data:image/svg+xml;base64,${b64}`;
}
