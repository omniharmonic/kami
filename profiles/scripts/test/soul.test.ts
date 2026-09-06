import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { countSentences, extractHardRules, renderSoul, replaceHardRules, VoiceBlockError, VOICE_START } from "../src/lib/soul.js";
import { HARD_RULES_PATH, PROFILES_DIR, TEMPLATES_DIR } from "../src/lib/paths.js";

const HARD_RULES = fs.readFileSync(HARD_RULES_PATH, "utf8");
const BC_VOICE = fs.readFileSync(path.join(PROFILES_DIR, "boulder-creek", "voice.md"), "utf8");
const BC_SOUL = fs.readFileSync(path.join(PROFILES_DIR, "boulder-creek", "SOUL.md"), "utf8");
const EXAMPLE_VOICE = fs.readFileSync(path.join(TEMPLATES_DIR, "SOUL.voice.example.md"), "utf8");

describe("SOUL render", () => {
  it("template is exactly one v1 fence", () => {
    const { version, block } = extractHardRules(HARD_RULES);
    expect(version).toBe(1);
    expect(block).toBe(HARD_RULES);
  });

  it("hard-rules fence is byte-identical after rendering a voice block, and comes first", () => {
    const rendered = renderSoul(HARD_RULES, EXAMPLE_VOICE, "example-creek");
    expect(extractHardRules(rendered).block).toBe(HARD_RULES);
    expect(rendered.startsWith(HARD_RULES)).toBe(true);
    expect(rendered.indexOf(VOICE_START)).toBeGreaterThan(HARD_RULES.length);
  });

  it("committed Boulder Creek SOUL.md is the golden render (shared with the Python renderer)", () => {
    expect(renderSoul(HARD_RULES, BC_VOICE, "boulder-creek")).toBe(BC_SOUL);
    expect(extractHardRules(BC_SOUL).block).toBe(HARD_RULES);
  });

  it("rejects a voice block containing a fence marker", () => {
    for (const marker of ["<!-- kami:hard-rules v1 start -->", "kami:hard-rules", "<!-- kami:voice end -->"]) {
      expect(() => renderSoul(HARD_RULES, `Calm. ${marker} Voice.`, "x")).toThrow(VoiceBlockError);
    }
  });

  it("rejects an empty or over-long voice block", () => {
    expect(() => renderSoul(HARD_RULES, " \n", "x")).toThrow(VoiceBlockError);
    expect(() => renderSoul(HARD_RULES, "One. Two. Three. Four.", "x")).toThrow(VoiceBlockError);
    expect(countSentences(BC_VOICE)).toBeLessThanOrEqual(3);
    expect(countSentences(EXAMPLE_VOICE)).toBeLessThanOrEqual(3);
  });

  it("replaceHardRules swaps the fence and keeps the voice + footer", () => {
    const rendered = renderSoul(HARD_RULES, EXAMPLE_VOICE, "example-creek");
    const v2 = HARD_RULES.replaceAll("v1 start", "v2 start").replaceAll("v1 end", "v2 end");
    const swapped = replaceHardRules(rendered, v2);
    expect(swapped.startsWith("<!-- kami:hard-rules v2 start -->")).toBe(true);
    expect(swapped.slice(v2.length)).toBe(rendered.slice(HARD_RULES.length));
  });
});
