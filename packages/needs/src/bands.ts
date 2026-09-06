/**
 * Health per need from PUBLISHED bands only (architecture §9.3).
 *
 * Nothing here is a judgement of ours: every threshold below is copied from a
 * published table and cited. A property with no published band returns
 * `{ band: null, health: null }` and the meter shows value + trend only.
 *
 * Percentile bands apply only when the twin publishes a baseline on the
 * reading (`context.percentile`, TW-5) and then take precedence over the
 * property table, because "low for September" is the more specific fact.
 */

import type { DroughtClass, FloodCategory } from "./types.js";

export type Band = { band: string | null; health: number | null };

const NONE: Band = { band: null, health: null };

function finite(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

// ---------------------------------------------------------------------------
// reservoir_fill — % of normal (PRD §6.3; architecture §9.3)
// ---------------------------------------------------------------------------

/** `<40 → 0.2, 40–70 → 0.5, ≥70 → 0.8`. Labels are ours (the twin publishes none). */
export function reservoirFillBand(pct: number | null | undefined): Band {
  if (!finite(pct) || pct < 0) return NONE;
  if (pct < 40) return { band: "low", health: 0.2 };
  if (pct < 70) return { band: "below normal", health: 0.5 };
  return { band: "near normal", health: 0.8 };
}

// ---------------------------------------------------------------------------
// EPA AQI breakpoints — 2024 revision
//
// Source: US EPA, "Reconsideration of the National Ambient Air Quality
// Standards for Particulate Matter", final rule 2024-02-07 (89 FR 16202),
// 40 CFR Part 58 Appendix G, Table 2 (effective 2024-05-06). PM2.5 24-hour
// breakpoints (µg/m³, truncated to one decimal):
//   Good 0.0–9.0 · Moderate 9.1–35.4 · Unhealthy for Sensitive Groups
//   35.5–55.4 · Unhealthy 55.5–125.4 · Very Unhealthy 125.5–225.4 ·
//   Hazardous 225.5+.
// Ozone 8-hour breakpoints (ppm, truncated to three decimals) are unchanged
// from the 2015 standard: Good 0.000–0.054 · Moderate 0.055–0.070 · USG
// 0.071–0.085 · Unhealthy 0.086–0.105 · Very Unhealthy 0.106–0.200. Above
// 0.200 EPA switches to the 1-hour scale; this package labels such an 8-hour
// mean "Hazardous" (health 0.05) rather than pretend it is unknown.
// Health values per category are ours (architecture §9.3 gives none):
//   Good 0.9 · Moderate 0.7 · USG 0.4 · Unhealthy 0.2 · Very Unhealthy 0.1 ·
//   Hazardous 0.05.
// ---------------------------------------------------------------------------

type EpaRow = { upper: number; band: string; health: number };

const EPA_PM25_24H: EpaRow[] = [
  { upper: 9.0, band: "Good", health: 0.9 },
  { upper: 35.4, band: "Moderate", health: 0.7 },
  { upper: 55.4, band: "Unhealthy for Sensitive Groups", health: 0.4 },
  { upper: 125.4, band: "Unhealthy", health: 0.2 },
  { upper: 225.4, band: "Very Unhealthy", health: 0.1 },
  { upper: Number.POSITIVE_INFINITY, band: "Hazardous", health: 0.05 },
];

const EPA_OZONE_8H: EpaRow[] = [
  { upper: 0.054, band: "Good", health: 0.9 },
  { upper: 0.07, band: "Moderate", health: 0.7 },
  { upper: 0.085, band: "Unhealthy for Sensitive Groups", health: 0.4 },
  { upper: 0.105, band: "Unhealthy", health: 0.2 },
  { upper: 0.2, band: "Very Unhealthy", health: 0.1 },
  { upper: Number.POSITIVE_INFINITY, band: "Hazardous", health: 0.05 },
];

/** EPA truncation (not rounding) to `decimals` places, as the AQI method requires. */
function truncate(v: number, decimals: number): number {
  const f = 10 ** decimals;
  // add a hair of epsilon so 35.4 stored as 35.399999 does not truncate to 35.3
  return Math.floor(v * f + 1e-9) / f;
}

function epaLookup(rows: EpaRow[], v: number): Band {
  for (const row of rows) {
    if (v <= row.upper) return { band: row.band, health: row.health };
  }
  return NONE;
}

/** PM2.5 24-hour mean in µg/m³ (`ug/m3`). */
export function pm25Band(ugm3: number | null | undefined): Band {
  if (!finite(ugm3) || ugm3 < 0) return NONE;
  return epaLookup(EPA_PM25_24H, truncate(ugm3, 1));
}

/** Ozone 8-hour mean in ppm. */
export function ozoneBand(ppm: number | null | undefined): Band {
  if (!finite(ppm) || ppm < 0) return NONE;
  return epaLookup(EPA_OZONE_8H, truncate(ppm, 3));
}

// ---------------------------------------------------------------------------
// US Drought Monitor classes D0–D4 (https://droughtmonitor.unl.edu/About/AbouttheData/DroughtClassification.aspx)
// Health values are ours: D0 0.7 · D1 0.5 · D2 0.3 · D3 0.15 · D4 0.05.
// ---------------------------------------------------------------------------

const USDM: Record<DroughtClass, Band> = {
  0: { band: "D0", health: 0.7 },
  1: { band: "D1", health: 0.5 },
  2: { band: "D2", health: 0.3 },
  3: { band: "D3", health: 0.15 },
  4: { band: "D4", health: 0.05 },
};

export function isDroughtClass(v: unknown): v is DroughtClass {
  return v === 0 || v === 1 || v === 2 || v === 3 || v === 4;
}

/** USDM `dm` 0–4; null (no polygon / unknown) → null. */
export function usdmBand(dm: number | null | undefined): Band {
  if (!isDroughtClass(dm)) return NONE;
  return USDM[dm];
}

// ---------------------------------------------------------------------------
// NWS / NWPS flood categories (https://water.noaa.gov/about/flood-categories)
// Health values are ours: none 0.8 · action 0.5 · minor 0.35 · moderate 0.15 · major 0.05.
// ---------------------------------------------------------------------------

const FLOOD: Record<FloodCategory, Band> = {
  none: { band: "none", health: 0.8 },
  action: { band: "action", health: 0.5 },
  minor: { band: "minor", health: 0.35 },
  moderate: { band: "moderate", health: 0.15 },
  major: { band: "major", health: 0.05 },
};

export function isFloodCategory(v: unknown): v is FloodCategory {
  return v === "none" || v === "action" || v === "minor" || v === "moderate" || v === "major";
}

export function floodBand(category: FloodCategory | null | undefined): Band {
  if (!isFloodCategory(category)) return NONE;
  return FLOOD[category];
}

// ---------------------------------------------------------------------------
// Percentile bands (architecture §9.3): "very high flow is not good".
//   <10 → 0.1 · 10–25 → 0.3 · 25–75 → 0.7 · 75–90 → 0.8 · >90 → 0.6
// Boundaries: 10 and 25 belong to the band above them; 75 and 90 to the band
// below them (so 10 → 0.3, 25 → 0.7, 75 → 0.7, 90 → 0.8). Labels are ours.
// ---------------------------------------------------------------------------

export function percentileBand(pct: number | null | undefined): Band {
  if (!finite(pct) || pct < 0 || pct > 100) return NONE;
  if (pct < 10) return { band: "very low", health: 0.1 };
  if (pct < 25) return { band: "low", health: 0.3 };
  if (pct <= 75) return { band: "normal", health: 0.7 };
  if (pct <= 90) return { band: "high", health: 0.8 };
  return { band: "very high", health: 0.6 };
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/** Properties with a published band table, by the twin's property name. */
export const BANDED_PROPERTIES = ["reservoir_fill", "pm25", "ozone", "dm", "flood_category", "stage"] as const;

export type BandOptions = {
  /** `context.percentile` from the reading, when the twin publishes a baseline */
  percentile?: number | null;
  /** NWPS category for the anchor gauge (drives the `stage` property) */
  flood_category?: FloodCategory | null;
};

/**
 * Band + health for a property value. Percentile wins when present; else the
 * property's published table; else `{ null, null }`.
 */
export function bandFor(property: string, value: number | null | undefined, opts: BandOptions = {}): Band {
  if (finite(opts.percentile)) return percentileBand(opts.percentile);
  switch (property) {
    case "reservoir_fill":
      return reservoirFillBand(value);
    case "pm25":
      return pm25Band(value);
    case "ozone":
      return ozoneBand(value);
    case "dm":
      return usdmBand(value);
    case "stage":
    case "flood_category":
      return floodBand(opts.flood_category);
    default:
      return NONE;
  }
}

/** The published band name ("Moderate", "D1", "minor") or null. */
export function bandLabel(property: string, value: number | null | undefined, opts: BandOptions = {}): string | null {
  return bandFor(property, value, opts).band;
}
