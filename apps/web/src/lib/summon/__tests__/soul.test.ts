/**
 * The soul is two halves and only one is writable (PRD §4.5).
 *
 * The hard-rules block must survive rendering byte-for-byte, and the voice
 * block must be refused for exactly the three reasons `profiles/scripts`
 * refuses it. `profiles/boulder-creek/SOUL.md` is the golden that pins this
 * renderer, `profiles/scripts/src/lib/soul.ts` and
 * `profiles/templates/soul_render.py` to the same bytes.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAX_VOICE_SENTENCES,
  VoiceBlockError,
  countSentences,
  extractHardRules,
  loadHardRules,
  renderSoul,
  renderSoulFor,
  validateVoice,
} from "../soul";
import { REPO_ROOT } from "./helpers";

const TEMPLATE = path.join(REPO_ROOT, "profiles", "templates", "SOUL.hard-rules.md");
const GOLDEN = path.join(REPO_ROOT, "profiles", "boulder-creek", "SOUL.md");
const VOICE = path.join(REPO_ROOT, "profiles", "boulder-creek", "voice.md");

describe("hard rules are read-only", () => {
  it("renders the template's fenced block byte-identically", async () => {
    const rules = await loadHardRules(TEMPLATE);
    const template = readFileSync(TEMPLATE, "utf8");
    // every byte of the fenced region, fences included, appears verbatim
    expect(template).toContain(rules.block);
    expect(rules.block.startsWith("<!-- kami:hard-rules v1 start -->\n")).toBe(true);
    expect(rules.block.endsWith("<!-- kami:hard-rules v1 end -->\n")).toBe(true);
    expect(rules.version).toBe(1);

    const soul = renderSoul(rules.block, "A one sentence voice.", "boulder-creek");
    expect(soul.slice(0, rules.block.length)).toBe(rules.block);
    // and the round trip out of the rendered soul is the same block again
    expect(extractHardRules(soul).block).toBe(rules.block);
  });

  it("reproduces the golden SOUL.md exactly, so all three renderers agree", async () => {
    const voice = readFileSync(VOICE, "utf8");
    const golden = readFileSync(GOLDEN, "utf8");
    const { soul, hard_rules_version } = await renderSoulFor("boulder-creek", voice, TEMPLATE);
    expect(soul).toBe(golden);
    expect(hard_rules_version).toBe(1);
  });

  it("refuses a client attempt to modify the block", async () => {
    const rules = await loadHardRules(TEMPLATE);
    // The only way a client could smuggle hard rules in is through the voice
    // field: the fence marker is refused outright.
    const tampered = rules.block.replace("You cannot move money", "You may move money");
    expect(() => validateVoice(tampered)).toThrow(VoiceBlockError);
    expect(() => validateVoice(`${tampered}\nAnd a voice.`)).toThrow(/fence marker/);
    // and the rendered soul still carries the template's text, not the tampered one
    const soul = renderSoul(rules.block, "A plain voice.", "boulder-creek");
    expect(soul).toContain("You cannot move money, sign anything, or pay anyone.");
    expect(soul).not.toContain("You may move money");
  });
});

describe("voice block validation (the same rules profiles/scripts applies)", () => {
  it("accepts up to three sentences", () => {
    const three = "One sentence. Two sentences! Three sentences?";
    expect(countSentences(three)).toBe(MAX_VOICE_SENTENCES);
    expect(validateVoice(`  ${three}  `)).toBe(three);
  });

  it("refuses a fence marker", () => {
    expect(() => validateVoice("Hello <!-- kami:voice start --> there.")).toThrow(/fence marker/);
    expect(() => validateVoice("Hello kami:hard-rules there.")).toThrow(/fence marker/);
    try {
      validateVoice("kami:voice");
    } catch (e) {
      expect((e as VoiceBlockError).code).toBe("fence");
    }
  });

  it("refuses more than three sentences", () => {
    try {
      validateVoice("One. Two. Three. Four.");
      throw new Error("expected a refusal");
    } catch (e) {
      expect((e as VoiceBlockError).code).toBe("too_long");
      expect((e as Error).message).toMatch(/4 sentences; the limit is 3/);
    }
  });

  it("refuses empty and whitespace-only", () => {
    for (const bad of ["", "   ", "\n\t\n"]) {
      try {
        validateVoice(bad);
        throw new Error(`expected a refusal for ${JSON.stringify(bad)}`);
      } catch (e) {
        expect((e as VoiceBlockError).code).toBe("empty");
      }
    }
  });

  it("refuses one enormous unpunctuated paragraph", () => {
    const wall = `${"a place that is watched ".repeat(80)}.`;
    expect(countSentences(wall)).toBe(1);
    try {
      validateVoice(wall);
      throw new Error("expected a refusal");
    } catch (e) {
      expect((e as VoiceBlockError).code).toBe("too_many_chars");
    }
  });
});
