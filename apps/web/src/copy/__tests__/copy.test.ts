import { describe, expect, it } from "vitest";
import * as copy from "..";

const allStrings: string[] = [];
function walk(v: unknown) {
  if (typeof v === "string") allStrings.push(v);
  else if (Array.isArray(v)) v.forEach(walk);
  else if (v && typeof v === "object") Object.values(v).forEach(walk);
}
walk({ ...copy, disclosureLabel: undefined, humanDuration: undefined, forbiddenUrgency: undefined });

describe("copy", () => {
  it("renders the disclosure label exactly as ADR-E13 / docs/naming.md require", () => {
    expect(copy.disclosureLabel("Boulder Creek", "creek")).toBe(
      "I'm an AI voice for Boulder Creek, built on public sensor data — not the creek, not a legal person.",
    );
  });
  it('says "for", never "the voice of" or "as"', () => {
    for (const s of allStrings) {
      expect(s).not.toMatch(/the voice of/i);
      expect(s).not.toMatch(/speak(s|ing)? as /i);
    }
  });
  it("carries the templated state lines verbatim", () => {
    expect(copy.states.asleepStale).toBe("I can't feel my gauge");
    expect(copy.states.asleepGpuOff).toBe("I'm asleep — my thinking machine is off");
    expect(copy.states.asleepPaused).toBe("paused by my guardians");
    expect(copy.states.overBudget).toBe("I've talked a lot today; back tomorrow");
  });
  it("has no urgency language anywhere", () => {
    const re = new RegExp(copy.forbiddenUrgency.join("|"), "i");
    for (const s of allStrings) expect(s, s).not.toMatch(re);
  });
  // The rule (PRD §2, §13 #8) is about a *crypto* token: the product never
  // offers, promises, prices or governs by one. The word itself is ordinary
  // English elsewhere — model usage tokens on the admin dashboard, magic-link
  // and API tokens in auth copy — so the test names the speculative senses
  // rather than the substring, and allows any of them inside a refusal.
  const SPECULATIVE = [
    /\btokenomics\b/i,
    /\bairdrop/i,
    /\b(?:our|the|a|its|kami'?s)\s+token\b/i,
    /\btoken\s+(?:sale|launch|price|holders?|supply|swap)\b/i,
    /\b(?:governance|reputation|utility|community)\s+token\b/i,
    /\$KAMI\b/,
    /\bbuy\b[^.]{0,40}\btokens?\b/i,
  ];
  const REFUSAL = /no token|never issue|scam|not a (?:crypto )?token|nothing here is a crypto token/i;

  it("never offers, prices or governs by a crypto token", () => {
    for (const s of allStrings) {
      const speculative = SPECULATIVE.find((rx) => rx.test(s));
      if (speculative && !REFUSAL.test(s)) {
        throw new Error(
          `copy string matches ${speculative} without refusing it: ${JSON.stringify(s)}`,
        );
      }
    }
  });

  it("says plainly somewhere that there is no token", () => {
    expect(allStrings.some((s) => REFUSAL.test(s))).toBe(true);
  });
});
