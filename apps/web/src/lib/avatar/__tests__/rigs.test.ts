import { describe, expect, it } from "vitest";
import { ARCHETYPES, MOODS, STATE_MACHINE, VIEW_MODEL, isArchetype, rigFor, rigManifest, rigSrc } from "../rigs";
import { RIG_CHECKLIST } from "../checklist";

describe("rig manifest", () => {
  it("covers every archetype and no rig is available before the commission lands", () => {
    for (const a of ARCHETYPES) {
      expect(rigManifest[a]).toBeDefined();
      expect(rigManifest[a].available).toBe(false);
      expect(rigFor(a).src).toBe(`/rigs/${a}/${rigManifest[a].version}/${a}.riv`);
    }
  });
  it("resolves unknown archetypes to creek and honours an injected manifest", () => {
    expect(rigFor("volcano").archetype).toBe("creek");
    expect(isArchetype("mountain")).toBe(true);
    expect(isArchetype("ridge")).toBe(false);
    const m = { ...rigManifest, creek: { version: "v1", available: true } };
    expect(rigFor("creek", m)).toEqual({ archetype: "creek", version: "v1", available: true, src: rigSrc("creek", "v1") });
  });
  it("names match the input contract", () => {
    expect(STATE_MACHINE).toBe("Mood");
    expect(VIEW_MODEL).toBe("Kami");
    expect(MOODS).toEqual(["asleep", "content", "concerned", "distressed", "celebrating"]);
  });
  it("the checklist carries the brief's non-negotiables", () => {
    const text = RIG_CHECKLIST.map((c) => c.text).join(" ");
    expect(RIG_CHECKLIST.length).toBeGreaterThanOrEqual(10);
    for (const must of ["Five moods", "listening for a quiet gauge", "distinct from distressed", "Four seasons", "cosmetic_", "Reduced-motion", "60 fps"]) {
      expect(text).toContain(must);
    }
  });
});
