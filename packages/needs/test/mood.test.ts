import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  REASONS,
  alertLevel,
  computeSnapshot,
  type DroughtClass,
  type FloodCategory,
  type LiveInputs,
  type NeedInput,
  type NeedName,
  type NeedSpec,
  type NwsSeverity,
} from "../src/index.js";
import { SPECS, healthyReadings, hourLater, live, opts, reading } from "./helpers.js";

// ---------------------------------------------------------------------------
// G4 — stale on any weight>0 need forces asleep, for every other combination
// ---------------------------------------------------------------------------

const NEEDS: NeedName[] = ["flow", "storage", "snow", "water", "air", "drought", "stage", "fire", "alerts"];
const PROPS: Record<NeedName, string> = {
  flow: "discharge",
  storage: "reservoir_fill",
  snow: "swe",
  water: "dissolved_oxygen",
  air: "pm25",
  drought: "dm",
  stage: "stage",
  fire: "fire_perimeters",
  alerts: "alert_count",
};

const arbSeverity = fc.constantFrom<NwsSeverity>("Extreme", "Severe", "Moderate", "Minor", "Unknown");
const arbFlood = fc.option(fc.constantFrom<FloodCategory>("none", "action", "minor", "moderate", "major"), { nil: null });
const arbDrought = fc.option(fc.constantFrom<DroughtClass>(0, 1, 2, 3, 4), { nil: null });

const arbReading = fc.record({
  value: fc.option(fc.double({ min: 0, max: 300, noNaN: true }), { nil: null }),
  stale: fc.boolean(),
  percentile: fc.option(fc.double({ min: 0, max: 100, noNaN: true }), { nil: null }),
}).map(({ value, stale, percentile }): NeedInput => reading({ value, stale, context: percentile === null ? null : { percentile } }));

const arbNeed = fc.record({
  need: fc.constantFrom(...NEEDS),
  weight: fc.constantFrom(0, 0.25, 0.5, 1),
  reading: fc.option(arbReading, { nil: null }),
});

const arbCase = fc.record({
  needs: fc.uniqueArray(arbNeed, { minLength: 1, maxLength: 6, selector: (n) => n.need }),
  drought: arbDrought,
  alerts: fc.array(fc.record({ severity: arbSeverity }), { maxLength: 3 }),
  flood: arbFlood,
  bounty: fc.boolean(),
  paused: fc.boolean(),
  gpu_online: fc.boolean(),
});

function build(c: {
  needs: { need: NeedName; weight: number; reading: NeedInput | null }[];
  drought: DroughtClass | null;
  alerts: { severity: NwsSeverity }[];
  flood: FloodCategory | null;
  bounty: boolean;
  paused: boolean;
  gpu_online: boolean;
}) {
  const specs: NeedSpec[] = c.needs.map((n) => ({ need: n.need, property: PROPS[n.need], places: [`place/${n.need}`], agg: "single", weight: n.weight }));
  const readings = Object.fromEntries(c.needs.map((n) => [n.need, n.reading])) as Partial<Record<NeedName, NeedInput | null>>;
  const lv: LiveInputs = live({ drought_class: c.drought, alerts: c.alerts, flood_category: c.flood, bounty_completed_in_24h: c.bounty });
  return computeSnapshot("entity/test", specs, readings, lv, opts({ paused: c.paused, gpu_online: c.gpu_online }));
}

describe("G4 — stale ≠ sad (property, 1,000 cases)", () => {
  it("any weight>0 need with stale=true forces mood asleep with the stale reason unless paused/gpu-off win", () => {
    fc.assert(
      fc.property(arbCase, (c) => {
        const snap = build(c);
        const staleDriving = c.needs.some((n) => n.weight > 0 && n.reading?.stale === true);
        expect(snap.stale_driving).toBe(staleDriving);
        if (staleDriving) {
          expect(snap.mood).toBe("asleep");
          if (!c.paused && c.gpu_online) expect(snap.mood_reason).toBe(REASONS.stale);
        }
        // never distressed while a driving reading is stale, whatever else is true
        if (staleDriving) expect(snap.mood).not.toBe("distressed");
        // stale needs never carry a health
        for (const n of snap.needs) if (n.stale) expect(n.health).toBeNull();
      }),
      { numRuns: 1000 },
    );
  });

  it("paused and gpu_online:false win over everything (property)", () => {
    fc.assert(
      fc.property(arbCase, (c) => {
        const snap = build(c);
        if (c.paused) {
          expect(snap.mood).toBe("asleep");
          expect(snap.mood_reason).toBe(REASONS.paused);
        } else if (!c.gpu_online) {
          expect(snap.mood).toBe("asleep");
          expect(snap.mood_reason).toBe(REASONS.gpu_off);
        }
      }),
      { numRuns: 300 },
    );
  });
});

// ---------------------------------------------------------------------------
// Rules, one at a time
// ---------------------------------------------------------------------------

describe("mood rules 1–7", () => {
  const compute = (lv: Partial<LiveInputs> = {}, o: Parameters<typeof opts>[0] = {}, readings = healthyReadings()) =>
    computeSnapshot("entity/test", SPECS, readings, live(lv), opts(o));

  it("rule 1: paused → asleep 'paused by my guardians', even with a severe alert", () => {
    const s = compute({ alerts: [{ severity: "Extreme" }] }, { paused: true });
    expect(s.mood).toBe("asleep");
    expect(s.mood_reason).toBe("paused by my guardians");
  });

  it("rule 1: gpu_online=false → asleep 'my thinking machine is off'", () => {
    const s = compute({ drought_class: 4 }, { gpu_online: false });
    expect(s.mood).toBe("asleep");
    expect(s.mood_reason).toBe("my thinking machine is off");
  });

  it("rule 2: stale flow → asleep 'I can't feel my gauge' — not distressed, even in D4", () => {
    const r = healthyReadings();
    r.flow = reading({ ...r.flow!, stale: true, staleness_s: 118000, source_status: "critical" });
    const s = compute({ drought_class: 4 }, {}, r);
    expect(s.mood).toBe("asleep");
    expect(s.mood_reason).toBe("I can't feel my gauge");
  });

  it("rule 2 does not fire for a weight-0 need", () => {
    const specs = SPECS.map((sp) => (sp.need === "snow" ? { ...sp, weight: 0 } : sp));
    const r = healthyReadings();
    r.snow = reading({ ...r.snow!, stale: true });
    const s = computeSnapshot("entity/test", specs, r, live(), opts());
    expect(s.stale_driving).toBe(false);
    expect(s.mood).toBe("content");
  });

  it("rule 3: alert_level 3 → distressed", () => {
    const s = compute({ alerts: [{ severity: "Severe" }] });
    expect(s.alert_level).toBe(3);
    expect(s.mood).toBe("distressed");
    expect(s.mood_reason).toBe(REASONS.severe_alert);
  });

  it("rule 3: flood moderate/major → distressed", () => {
    expect(compute({ flood_category: "moderate" }).mood).toBe("distressed");
    const s = compute({ flood_category: "major" });
    expect(s.mood).toBe("distressed");
    expect(s.mood_reason).toBe("major flooding at my gauge");
  });

  it("rule 4: drought D2 → distressed 'drought D2 in my watershed'", () => {
    const s = compute({ drought_class: 2 });
    expect(s.mood).toBe("distressed");
    expect(s.mood_reason).toBe("drought D2 in my watershed");
  });

  it("rule 4: any need health ≤ 0.15 → distressed (air Very Unhealthy)", () => {
    const r = healthyReadings();
    r.air = reading({ value: 150, unit: "ug/m3" });
    const s = compute({}, {}, r);
    expect(s.mood).toBe("distressed");
    expect(s.mood_reason).toBe("my air reads Very Unhealthy");
  });

  it("rule 5: drought D1 → concerned 'drought D1 in my watershed'", () => {
    const s = compute({ drought_class: 1 });
    expect(s.mood).toBe("concerned");
    expect(s.mood_reason).toBe("drought D1 in my watershed");
  });

  it("rule 5: alert_level 2 → concerned; flood action/minor → concerned", () => {
    expect(compute({ alerts: [{ severity: "Moderate" }] }).mood).toBe("concerned");
    expect(compute({ flood_category: "action" }).mood).toBe("concerned");
    expect(compute({ flood_category: "minor" }).mood_reason).toBe("minor flood stage at my gauge");
  });

  it("rule 5: any need health ≤ 0.35 → concerned (reservoir fill 30 %)", () => {
    const r = healthyReadings();
    r.storage = reading({ value: 30, unit: "%" });
    const s = compute({}, {}, r);
    expect(s.mood).toBe("concerned");
    expect(s.mood_reason).toBe("my storage reads low");
  });

  it("rule 5: mean health ≤ 0.5 → concerned", () => {
    // storage 55 % → 0.5 (weight 1) alone: mean 0.5 → concerned
    const r = healthyReadings();
    r.storage = reading({ value: 55, unit: "%" });
    r.air = null;
    const s = compute({}, {}, r);
    expect(s.mood).toBe("concerned");
    expect(s.mood_reason).toBe(REASONS.mean_low);
  });

  it("rule 6: BountyCompleted in 24 h with everything else fine → celebrating", () => {
    const s = compute({ bounty_completed_in_24h: true });
    expect(s.mood).toBe("celebrating");
    expect(s.mood_reason).toBe(REASONS.bounty);
  });

  it("rule 6 never beats rules 1–5 (bounty + D1 → concerned)", () => {
    expect(compute({ bounty_completed_in_24h: true, drought_class: 1 }).mood).toBe("concerned");
  });

  it("rule 7: otherwise content", () => {
    const s = compute();
    expect(s.mood).toBe("content");
    expect(s.mood_reason).toBe(REASONS.content);
  });

  it("D0 alone is not concern (health 0.7, mean > 0.5)", () => {
    expect(compute({ drought_class: 0 }).mood).toBe("content");
  });

  it("drought_class null → drought does not drive", () => {
    expect(compute({ drought_class: null }).drought_class).toBeNull();
  });
});

describe("alertLevel", () => {
  it("maps NWS severities", () => {
    expect(alertLevel([])).toBe(0);
    expect(alertLevel(null)).toBe(0);
    expect(alertLevel([{ severity: "Minor" }])).toBe(1);
    expect(alertLevel([{ severity: "Unknown" }])).toBe(1);
    expect(alertLevel([{ severity: "Minor" }, { severity: "Moderate" }])).toBe(2);
    expect(alertLevel([{ severity: "Moderate" }, { severity: "Severe" }])).toBe(3);
    expect(alertLevel([{ severity: "Extreme" }])).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Hysteresis
// ---------------------------------------------------------------------------

describe("hysteresis", () => {
  const compute = (lv: Partial<LiveInputs>, o: Parameters<typeof opts>[0] = {}, readings = healthyReadings()) =>
    computeSnapshot("entity/test", SPECS, readings, live(lv), opts(o));

  it("content → concerned needs two agreeing hourly snapshots", () => {
    const o = opts();
    const h0 = compute({}, o);
    expect(h0.mood).toBe("content");

    const h1 = compute({ drought_class: 1 }, { now: hourLater(o, 1), previous_snapshots: [h0] });
    expect(h1.mood).toBe("content"); // held: first hour of the new candidate
    expect(h1.mood_reason).toBe(h0.mood_reason);
    expect(h1.drought_class).toBe(1); // the data is published; only the face waits

    const h2 = compute({ drought_class: 1 }, { now: hourLater(o, 2), previous_snapshots: [h0, h1] });
    expect(h2.mood).toBe("concerned");
    expect(h2.mood_reason).toBe("drought D1 in my watershed");
  });

  it("a one-hour blip does not flip the face", () => {
    const o = opts();
    const h0 = compute({}, o);
    const h1 = compute({ drought_class: 1 }, { now: hourLater(o, 1), previous_snapshots: [h0] });
    const h2 = compute({}, { now: hourLater(o, 2), previous_snapshots: [h0, h1] });
    expect(h1.mood).toBe("content");
    expect(h2.mood).toBe("content");
  });

  it("→ distressed is immediate", () => {
    const o = opts();
    const h0 = compute({}, o);
    const h1 = compute({ drought_class: 2 }, { now: hourLater(o, 1), previous_snapshots: [h0] });
    expect(h1.mood).toBe("distressed");
  });

  it("→ asleep is immediate", () => {
    const o = opts();
    const h0 = compute({}, o);
    const r = healthyReadings();
    r.flow = reading({ ...r.flow!, stale: true });
    const h1 = compute({}, { now: hourLater(o, 1), previous_snapshots: [h0] }, r);
    expect(h1.mood).toBe("asleep");
    expect(h1.mood_reason).toBe("I can't feel my gauge");
  });

  it("asleep → content takes two hours (waking up is not immediate)", () => {
    const o = opts();
    const r = healthyReadings();
    r.flow = reading({ ...r.flow!, stale: true });
    const h0 = compute({}, o, r);
    expect(h0.mood).toBe("asleep");
    const h1 = compute({}, { now: hourLater(o, 1), previous_snapshots: [h0] });
    expect(h1.mood).toBe("asleep");
    const h2 = compute({}, { now: hourLater(o, 2), previous_snapshots: [h0, h1] });
    expect(h2.mood).toBe("content");
  });

  it("distressed → concerned takes two hours; distressed → distressed with a new reason refreshes", () => {
    const o = opts();
    const h0 = compute({ drought_class: 2 }, o);
    const h1 = compute({ drought_class: 1 }, { now: hourLater(o, 1), previous_snapshots: [h0] });
    expect(h1.mood).toBe("distressed");
    const h2 = compute({ drought_class: 1 }, { now: hourLater(o, 2), previous_snapshots: [h0, h1] });
    expect(h2.mood).toBe("concerned");
    const h3 = compute({ drought_class: 3 }, { now: hourLater(o, 3), previous_snapshots: [h2] });
    expect(h3.mood_reason).toBe("drought D3 in my watershed");
  });

  it("uses the latest previous snapshot by as_of regardless of array order", () => {
    const o = opts();
    const h0 = compute({}, o);
    const h1 = compute({ drought_class: 1 }, { now: hourLater(o, 1), previous_snapshots: [h0] });
    const h2 = compute({ drought_class: 1 }, { now: hourLater(o, 2), previous_snapshots: [h1, h0] });
    expect(h2.mood).toBe("concerned");
  });

  it("paused wins even over a held mood", () => {
    const o = opts();
    const h0 = compute({ drought_class: 1 }, o);
    const h1 = compute({ drought_class: 1 }, { now: hourLater(o, 1), previous_snapshots: [h0], paused: true });
    expect(h1.mood).toBe("asleep");
    expect(h1.mood_reason).toBe("paused by my guardians");
  });
});
