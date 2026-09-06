/**
 * ADR-E07's load-bearing promise: **a visitor and a donor never trigger Privy.**
 *
 * This walks the static import graph from the three routes an unauthenticated
 * person can reach — the landing page, an entity page and the donation page —
 * and asserts that `@privy-io/react-auth` is nowhere in their closure, by any
 * route, including through a shared component. It then asserts the one surface
 * that *does* load it (`/me/wallet`) reaches it only through
 * `next/dynamic(..., { ssr: false })`, so it is a separate client chunk.
 *
 * A static walk rather than a render: the guarantee is about what the bundler
 * puts in the page, which no render can observe.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const PRIVY_PACKAGES = ["@privy-io/react-auth", "@privy-io/server-auth"];
const EXTS = [".ts", ".tsx", ".js", ".jsx"];

export type Edge = { spec: string; dynamic: boolean };

const STATIC_RE = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s*["']([^"']+)["']/g;
const BARE_RE = /(?:^|\n)\s*import\s*["']([^"']+)["']/g;
const DYNAMIC_RE = /import\s*\(\s*["']([^"']+)["']\s*\)|require\(\s*["']([^"']+)["']\s*\)/g;

function specifiersIn(source: string): Edge[] {
  const out: Edge[] = [];
  for (const m of source.matchAll(STATIC_RE)) if (m[1]) out.push({ spec: m[1], dynamic: false });
  for (const m of source.matchAll(BARE_RE)) if (m[1]) out.push({ spec: m[1], dynamic: false });
  for (const m of source.matchAll(DYNAMIC_RE)) {
    const spec = m[1] ?? m[2];
    if (spec) out.push({ spec, dynamic: true });
  }
  return out;
}

function resolve(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
  else return null; // a package, not our source
  for (const e of EXTS) if (existsSync(base + e)) return base + e;
  for (const e of EXTS) if (existsSync(path.join(base, `index${e}`))) return path.join(base, `index${e}`);
  return existsSync(base) && !existsSync(path.join(base, "..")) ? base : null;
}

/** Every one of our files reachable from `entry`, plus every package specifier seen. */
function closure(entry: string): { files: Set<string>; staticPackages: Set<string>; allPackages: Set<string>; edges: Map<string, Edge[]> } {
  const files = new Set<string>();
  const staticPackages = new Set<string>();
  const allPackages = new Set<string>();
  const edges = new Map<string, Edge[]>();
  const queue: Array<{ file: string; viaStatic: boolean }> = [{ file: entry, viaStatic: true }];
  while (queue.length) {
    const { file, viaStatic } = queue.pop()!;
    if (files.has(file) || !existsSync(file)) continue;
    files.add(file);
    const specs = specifiersIn(readFileSync(file, "utf8"));
    edges.set(file, specs);
    for (const e of specs) {
      const resolved = resolve(e.spec, file);
      const stillStatic = viaStatic && !e.dynamic;
      if (resolved) queue.push({ file: resolved, viaStatic: stillStatic });
      else {
        allPackages.add(e.spec);
        if (stillStatic) staticPackages.add(e.spec);
      }
    }
  }
  return { files, staticPackages, allPackages, edges };
}

const LANDING = path.join(SRC, "app/page.tsx");
const ENTITY = path.join(SRC, "app/e/[slug]/page.tsx");
const DONATE = path.join(SRC, "app/e/[slug]/donate/page.tsx");
const WALLET = path.join(SRC, "app/me/wallet/page.tsx");

describe("Privy is loaded lazily, on three surfaces only (ADR-E07)", () => {
  it("the walker actually sees the graph (it would be vacuously true otherwise)", () => {
    expect(existsSync(LANDING)).toBe(true);
    const { files, allPackages } = closure(DONATE);
    expect(files.size).toBeGreaterThan(5);
    expect(allPackages.size).toBeGreaterThan(3);
    // the donate page really does reach the copy module, so the walk is following edges
    expect([...files].some((f) => f.endsWith(path.join("lib", "donations", "copy.ts")))).toBe(true);
  });

  it.each([
    ["the landing page", LANDING],
    ["an entity page", ENTITY],
    ["the donation page", DONATE],
  ])("%s never imports Privy, by any route", (_name, entry) => {
    const { staticPackages, allPackages, files, edges } = closure(entry);
    const offender = (pkg: string) => [...edges.entries()].find(([, specs]) => specs.some((e) => e.spec === pkg))?.[0] ?? "?";
    // the browser SDK must not be reachable at all: any edge would ship a chunk
    expect(allPackages.has("@privy-io/react-auth"), `${entry} reaches @privy-io/react-auth via ${offender("@privy-io/react-auth")}`).toBe(false);
    // the server SDK must not be a *static* import; `signing/kms.ts` reaches it
    // only inside `await import(...)`, which no page bundle pays for
    expect(staticPackages.has("@privy-io/server-auth"), `${entry} statically imports @privy-io/server-auth via ${offender("@privy-io/server-auth")}`).toBe(false);
    expect(PRIVY_PACKAGES).toHaveLength(2);
    // nor our own Privy client modules
    for (const f of files) {
      expect(f.includes(path.join("lib", "privy", "client"))).toBe(false);
      expect(f.includes(path.join("lib", "privy", "hooks"))).toBe(false);
      expect(f.includes(path.join("components", "wallet"))).toBe(false);
    }
  });

  it("/me/wallet reaches Privy only through next/dynamic with ssr: false", () => {
    const { files } = closure(WALLET);
    const client = path.join(SRC, "lib/privy/client.tsx");
    expect(files.has(client)).toBe(true);

    const source = readFileSync(client, "utf8");
    expect(source).toContain('from "next/dynamic"');
    expect(source).toMatch(/ssr:\s*false/);
    // the SDK is only ever reached inside the dynamic() callback
    expect(source).toMatch(/dynamic\(\s*async \(\) => \{[\s\S]*?await import\("@privy-io\/react-auth"\)/);
    expect(source).not.toMatch(/^import .*@privy-io\/react-auth/m);
  });

  it("the client provider and the signing hook are imported by nothing outside the wallet and guardian trees", () => {
    const roots = [LANDING, ENTITY, DONATE];
    for (const root of roots) {
      const { edges } = closure(root);
      for (const [file, specs] of edges) {
        for (const e of specs) {
          expect(e.spec.includes("privy/client"), `${file} imports ${e.spec}`).toBe(false);
          expect(e.spec.includes("privy/hooks"), `${file} imports ${e.spec}`).toBe(false);
        }
      }
    }
  });
});
