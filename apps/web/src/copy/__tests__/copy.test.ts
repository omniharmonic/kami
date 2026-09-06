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
  it("never mentions a token except to refuse one", () => {
    for (const s of allStrings.filter((x) => /token/i.test(x))) {
      expect(s).toMatch(/no token|scam|not for|not.*token|magic|link/i);
    }
  });
});
