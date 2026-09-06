import { readdirSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MOOD_NAMES,
  VIEW_MODEL_PROPERTIES,
  ariaLabel,
  fallbackSrc,
  headlineText,
  moodName,
  offlineInputs,
  prefersReducedMotion,
  riveInputsToViewModel,
  snapshotToRiveInputs,
  type HealthSnapshot,
  type RiveInputs,
} from "../inputs";
import { ARCHETYPES, MOODS } from "../rigs";
import fixture from "@/fixtures/status/boulder-creek.json";

const snapshot = fixture.snapshot as HealthSnapshot;
const FALLBACK_DIR = path.join(process.cwd(), "public", "rigs", "fallback");

describe("fallbackSrc", () => {
  const files = new Set(readdirSync(FALLBACK_DIR));

  it("maps every archetype × mood to an SVG that exists on disk", () => {
    for (const a of ARCHETYPES) {
      for (const m of MOODS) {
        const src = fallbackSrc(a, m);
        expect(src).toBe(`/rigs/fallback/${a}-${m}.svg`);
        expect(files.has(path.basename(src)), `${src} missing`).toBe(true);
      }
    }
    expect(files.size).toBe(ARCHETYPES.length * MOODS.length);
  });

  it("falls back to creek / asleep for unknown or unsafe values", () => {
    expect(fallbackSrc("../etc", "content")).toBe("/rigs/fallback/creek-content.svg");
    expect(fallbackSrc("creek", "furious")).toBe("/rigs/fallback/creek-asleep.svg");
  });
});

describe("ariaLabel", () => {
  it("is mood_reason + the anchor need's label for the stale Boulder Creek fixture", () => {
    const label = ariaLabel(snapshot, "Boulder Creek");
    expect(label).toContain("Boulder Creek");
    expect(label).toContain("I can't feel my gauge");
    expect(label).toContain("Flow: 15.4 cfs at Orodell, 2026-09-04 20:15Z, stale");
    expect(label).toBe("Boulder Creek — I can't feel my gauge. Flow: 15.4 cfs at Orodell, 2026-09-04 20:15Z, stale");
  });

  it("copes with no snapshot (unknown, never distressed) and no needs", () => {
    expect(ariaLabel(null, "X")).toMatch(/^X — I can't reach my senses/);
    expect(headlineText({ ...snapshot, needs: [] })).toBeNull();
    expect(ariaLabel({ ...snapshot, needs: [] }, "X")).toBe("X — I can't feel my gauge");
  });
});

describe("riveInputsToViewModel", () => {
  const inputs: RiveInputs = {
    flow_pct: 42,
    snow_pct: -1,
    air_pct: 77,
    temp_pct: -1,
    alert_level: 2,
    drought: 1,
    mood: 2,
    stale: false,
    paused: true,
    gpu_online: false,
    season: 3,
    headline_label: "42nd percentile flow at Orodell",
    cosmetic_hat: 2,
    cosmetic_scarf: 0,
  };
  const vm = riveInputsToViewModel(inputs);

  it("flow_pct", () => expect(vm.flow_pct).toEqual({ kind: "number", name: "flow_pct", value: 42 }));
  it("snow_pct (−1 = absent, never 0)", () => expect(vm.snow_pct).toEqual({ kind: "number", name: "snow_pct", value: -1 }));
  it("air_pct (raw, not inverted)", () => expect(vm.air_pct).toEqual({ kind: "number", name: "air_pct", value: 77 }));
  it("temp_pct", () => expect(vm.temp_pct).toEqual({ kind: "number", name: "temp_pct", value: -1 }));
  it("alert_level", () => expect(vm.alert_level).toEqual({ kind: "number", name: "alert_level", value: 2 }));
  it("drought", () => expect(vm.drought).toEqual({ kind: "number", name: "drought", value: 1 }));
  it("mood as the Mood enum by name with the §9.2 index", () =>
    expect(vm.mood).toEqual({ kind: "enum", name: "mood", enum: "Mood", value: "concerned", index: 2, values: MOODS }));
  it("stale", () => expect(vm.stale).toEqual({ kind: "boolean", name: "stale", value: false }));
  it("paused", () => expect(vm.paused).toEqual({ kind: "boolean", name: "paused", value: true }));
  it("gpu_online", () => expect(vm.gpu_online).toEqual({ kind: "boolean", name: "gpu_online", value: false }));
  it("season", () => expect(vm.season).toEqual({ kind: "number", name: "season", value: 3 }));
  it("headline_label as a string", () =>
    expect(vm.headline_label).toEqual({ kind: "string", name: "headline_label", value: "42nd percentile flow at Orodell" }));
  it("cosmetic_* slots, numbers only, by their own name", () => {
    expect(vm.cosmetic_hat).toEqual({ kind: "number", name: "cosmetic_hat", value: 2 });
    expect(vm.cosmetic_scarf).toEqual({ kind: "number", name: "cosmetic_scarf", value: 0 });
  });
  it("declares every contract property and nothing else beyond cosmetics", () => {
    for (const p of VIEW_MODEL_PROPERTIES) expect(vm[p]).toBeDefined();
    const extra = Object.keys(vm).filter((k) => !(VIEW_MODEL_PROPERTIES as readonly string[]).includes(k));
    expect(extra.every((k) => k.startsWith("cosmetic_"))).toBe(true);
  });
  it("normalises garbage: non-finite numbers → −1, unknown mood → asleep", () => {
    const bad = riveInputsToViewModel({ ...inputs, flow_pct: Number.NaN, mood: 9 as 0 });
    expect(bad.flow_pct).toMatchObject({ value: -1 });
    expect(bad.mood).toMatchObject({ value: "asleep", index: 0 });
  });
});

describe("snapshot → inputs → view model (the fixture)", () => {
  it("stale driving flow forces mood asleep and stale=true all the way through", () => {
    const inputs = snapshotToRiveInputs(snapshot);
    expect(inputs.mood).toBe(0);
    expect(inputs.stale).toBe(true);
    expect(inputs.flow_pct).toBe(-1);
    const vm = riveInputsToViewModel(inputs);
    expect(vm.mood).toMatchObject({ value: "asleep" });
    expect(vm.stale).toMatchObject({ value: true });
    expect(vm.headline_label).toMatchObject({ value: "15.4 cfs at Orodell, 2026-09-04 20:15Z, stale" });
  });

  it("offlineInputs is asleep + stale, and moodName clamps", () => {
    expect(offlineInputs()).toMatchObject({ mood: 0, stale: true, flow_pct: -1 });
    expect(moodName(4)).toBe("celebrating");
    expect(moodName(42)).toBe("asleep");
    expect(MOOD_NAMES).toEqual(["asleep", "content", "concerned", "distressed", "celebrating"]);
  });
});

describe("prefersReducedMotion", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is false without a window", () => {
    expect(prefersReducedMotion()).toBe(false);
  });

  it("reads matchMedia when present and never throws", () => {
    vi.stubGlobal("window", { matchMedia: (q: string) => ({ matches: q.includes("reduce") }) });
    expect(prefersReducedMotion()).toBe(true);
    vi.stubGlobal("window", {
      matchMedia: () => {
        throw new Error("nope");
      },
    });
    expect(prefersReducedMotion()).toBe(false);
  });
});
