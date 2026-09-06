// @vitest-environment jsdom
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ARCHETYPES, MOODS } from "../rigs";

const DIR = path.join(process.cwd(), "public", "rigs", "fallback");
const MAX_BYTES = 6 * 1024;

describe("fallback SVGs", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".svg")).sort();

  it("are exactly the 25 archetype × mood files", () => {
    const expected = ARCHETYPES.flatMap((a) => MOODS.map((m) => `${a}-${m}.svg`)).sort();
    expect(files).toEqual(expected);
  });

  for (const file of files) {
    describe(file, () => {
      const text = readFileSync(path.join(DIR, file), "utf8");

      it("is ≤ 6 KB", () => {
        expect(statSync(path.join(DIR, file)).size).toBeLessThanOrEqual(MAX_BYTES);
      });

      it("parses as XML with the 240 viewBox and a <title> naming archetype + mood", () => {
        const doc = new DOMParser().parseFromString(text, "image/svg+xml");
        expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
        const svg = doc.documentElement;
        expect(svg.tagName).toBe("svg");
        expect(svg.getAttribute("viewBox")).toBe("0 0 240 240");
        const title = svg.querySelector("title");
        expect(title).not.toBeNull();
        const [archetype, mood] = file.replace(".svg", "").split("-");
        expect(title!.textContent!.toLowerCase()).toContain(archetype!);
        expect(title!.textContent!.toLowerCase()).toContain(mood!);
      });

      it("has no script, no event handlers and no external references", () => {
        expect(text).not.toMatch(/<script/i);
        expect(text).not.toMatch(/\son[a-z]+=/i);
        expect(text).not.toMatch(/(xlink:)?href\s*=\s*["'](?!#)/i);
        expect(text).not.toMatch(/url\(\s*["']?(?!#)/i);
        expect(text).not.toMatch(/@import|<foreignObject|<image/i);
      });

      it("uses the greyed stale palette only for asleep", () => {
        const isAsleep = file.endsWith("-asleep.svg");
        expect(text.includes("var(--kami-accent,#9a958e)")).toBe(isAsleep);
      });
    });
  }
});
