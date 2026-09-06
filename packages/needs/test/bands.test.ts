import { describe, expect, it } from "vitest";
import {
  bandFor,
  bandLabel,
  floodBand,
  ozoneBand,
  percentileBand,
  pm25Band,
  reservoirFillBand,
  usdmBand,
} from "../src/index.js";

describe("reservoir_fill (% of normal)", () => {
  it.each([
    [0, "low", 0.2],
    [39.9, "low", 0.2],
    [40, "below normal", 0.5],
    [69.9, "below normal", 0.5],
    [70, "near normal", 0.8],
    [72, "near normal", 0.8],
    [120, "near normal", 0.8],
  ])("%s %% → %s / %s", (v, band, health) => {
    expect(reservoirFillBand(v)).toEqual({ band, health });
  });
  it("null / negative / NaN → null", () => {
    expect(reservoirFillBand(null)).toEqual({ band: null, health: null });
    expect(reservoirFillBand(-1)).toEqual({ band: null, health: null });
    expect(reservoirFillBand(Number.NaN)).toEqual({ band: null, health: null });
  });
});

describe("EPA 2024 PM2.5 24-h", () => {
  it.each([
    [0, "Good", 0.9],
    [9.0, "Good", 0.9],
    [9.04, "Good", 0.9], // truncates to 9.0
    [9.1, "Moderate", 0.7],
    [35.4, "Moderate", 0.7],
    [35.5, "Unhealthy for Sensitive Groups", 0.4],
    [55.4, "Unhealthy for Sensitive Groups", 0.4],
    [55.5, "Unhealthy", 0.2],
    [125.4, "Unhealthy", 0.2],
    [125.5, "Very Unhealthy", 0.1],
    [225.4, "Very Unhealthy", 0.1],
    [225.5, "Hazardous", 0.05],
    [500, "Hazardous", 0.05],
  ])("%s µg/m³ → %s / %s", (v, band, health) => {
    expect(pm25Band(v)).toEqual({ band, health });
  });
  it("null / negative → null", () => {
    expect(pm25Band(null)).toEqual({ band: null, health: null });
    expect(pm25Band(-0.1)).toEqual({ band: null, health: null });
  });
});

describe("EPA ozone 8-h (ppm)", () => {
  it.each([
    [0, "Good", 0.9],
    [0.054, "Good", 0.9],
    [0.0549, "Good", 0.9], // truncates to 0.054
    [0.055, "Moderate", 0.7],
    [0.07, "Moderate", 0.7],
    [0.071, "Unhealthy for Sensitive Groups", 0.4],
    [0.085, "Unhealthy for Sensitive Groups", 0.4],
    [0.086, "Unhealthy", 0.2],
    [0.105, "Unhealthy", 0.2],
    [0.106, "Very Unhealthy", 0.1],
    [0.2, "Very Unhealthy", 0.1],
    [0.201, "Hazardous", 0.05],
  ])("%s ppm → %s / %s", (v, band, health) => {
    expect(ozoneBand(v)).toEqual({ band, health });
  });
});

describe("USDM dm", () => {
  it.each([
    [null, null, null],
    [0, "D0", 0.7],
    [1, "D1", 0.5],
    [2, "D2", 0.3],
    [3, "D3", 0.15],
    [4, "D4", 0.05],
    [5, null, null],
    [1.5, null, null],
  ])("%s → %s / %s", (v, band, health) => {
    expect(usdmBand(v as number | null)).toEqual({ band, health });
  });
});

describe("NWPS flood category", () => {
  it.each([
    ["none", 0.8],
    ["action", 0.5],
    ["minor", 0.35],
    ["moderate", 0.15],
    ["major", 0.05],
  ] as const)("%s → %s", (cat, health) => {
    expect(floodBand(cat)).toEqual({ band: cat, health });
  });
  it("null → null", () => {
    expect(floodBand(null)).toEqual({ band: null, health: null });
  });
});

describe("percentile bands", () => {
  it.each([
    [0, "very low", 0.1],
    [9.99, "very low", 0.1],
    [10, "low", 0.3],
    [24.99, "low", 0.3],
    [25, "normal", 0.7],
    [50, "normal", 0.7],
    [75, "normal", 0.7],
    [75.01, "high", 0.8],
    [90, "high", 0.8],
    [90.01, "very high", 0.6],
    [100, "very high", 0.6],
  ])("p%s → %s / %s", (v, band, health) => {
    expect(percentileBand(v)).toEqual({ band, health });
  });
  it("out of range → null", () => {
    expect(percentileBand(101)).toEqual({ band: null, health: null });
    expect(percentileBand(-1)).toEqual({ band: null, health: null });
    expect(percentileBand(null)).toEqual({ band: null, health: null });
  });
});

describe("bandFor / bandLabel dispatch", () => {
  it("percentile wins over the property table when present", () => {
    expect(bandFor("discharge", 15.4, { percentile: 5 })).toEqual({ band: "very low", health: 0.1 });
    expect(bandFor("reservoir_fill", 90, { percentile: 5 })).toEqual({ band: "very low", health: 0.1 });
  });
  it("unbanded properties → null (swe, dissolved_oxygen, discharge without percentile)", () => {
    for (const p of ["swe", "dissolved_oxygen", "discharge", "water_temperature", "nonsense"]) {
      expect(bandFor(p, 12)).toEqual({ band: null, health: null });
      expect(bandLabel(p, 12)).toBeNull();
    }
  });
  it("stage uses the flood category, not the value", () => {
    expect(bandFor("stage", 4.2, { flood_category: "minor" })).toEqual({ band: "minor", health: 0.35 });
    expect(bandFor("stage", 4.2)).toEqual({ band: null, health: null });
  });
  it("bandLabel returns the published names", () => {
    expect(bandLabel("pm25", 20)).toBe("Moderate");
    expect(bandLabel("dm", 1)).toBe("D1");
    expect(bandLabel("flood_category", null, { flood_category: "minor" })).toBe("minor");
    expect(bandLabel("reservoir_fill", 72)).toBe("near normal");
  });
});
