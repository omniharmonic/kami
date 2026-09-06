/**
 * Avatar inputs — the bridge from the typed HealthSnapshot (architecture §9.1)
 * to what the page and the Rive data binding need (§9.2, ADR-E09).
 *
 * `snapshotToRiveInputs` lives in @kami/needs (one implementation of the
 * binding, unit-tested per rule); this module re-exports it and adds:
 *  - `riveInputsToViewModel` — the same values typed for the ViewModel API
 *    (numbers / booleans / one enum / one string, by exact property name);
 *  - `fallbackSrc` — the static SVG per archetype × mood;
 *  - `ariaLabel` — mood_reason + the anchor need's label (§9.4);
 *  - `prefersReducedMotion` — safe anywhere (server, jsdom, browser).
 *
 * Nothing here decides mood. Mood arrives computed; stale → asleep (ADR-E11).
 */
import {
  MOOD_ENUM,
  snapshotToRiveInputs,
  type HealthSnapshot,
  type Mood,
  type RiveInputs,
} from "@kami/needs";
import { needLabel, states } from "@/copy";
import { MOODS, MOOD_ENUM_NAME, asArchetype, isMoodName, type MoodName } from "./rigs";

export { snapshotToRiveInputs, MOOD_ENUM };
export type { RiveInputs, HealthSnapshot, Mood };

/** Index = §9.2 enum value. */
export const MOOD_NAMES: readonly MoodName[] = MOODS;

export function moodName(index: number): MoodName {
  return MOODS[index] ?? "asleep";
}

// ---------------------------------------------------------------------------
// ViewModel shape
// ---------------------------------------------------------------------------

export type ViewModelNumber = { kind: "number"; name: string; value: number };
export type ViewModelBoolean = { kind: "boolean"; name: string; value: boolean };
export type ViewModelEnum = {
  kind: "enum";
  name: string;
  /** the Rive data-enum name */
  enum: string;
  value: string;
  index: number;
  values: readonly string[];
};
export type ViewModelString = { kind: "string"; name: string; value: string };
export type ViewModelValue = ViewModelNumber | ViewModelBoolean | ViewModelEnum | ViewModelString;

/** Keyed by the exact ViewModel property name the rig declares. */
export type AvatarViewModel = Record<string, ViewModelValue>;

/** Property names every rig must declare, in contract order (rive/INPUT-CONTRACT.md). */
export const VIEW_MODEL_PROPERTIES = [
  "flow_pct",
  "snow_pct",
  "air_pct",
  "temp_pct",
  "alert_level",
  "drought",
  "mood",
  "stale",
  "paused",
  "gpu_online",
  "season",
  "headline_label",
] as const;

const num = (v: unknown, fallback = -1): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

export function riveInputsToViewModel(inputs: RiveInputs): AvatarViewModel {
  const vm: AvatarViewModel = {};
  const number = (name: string, value: number) => {
    vm[name] = { kind: "number", name, value };
  };
  const boolean = (name: string, value: boolean) => {
    vm[name] = { kind: "boolean", name, value: value === true };
  };

  number("flow_pct", num(inputs.flow_pct));
  number("snow_pct", num(inputs.snow_pct));
  number("air_pct", num(inputs.air_pct));
  number("temp_pct", num(inputs.temp_pct));
  number("alert_level", num(inputs.alert_level, 0));
  number("drought", num(inputs.drought));
  const moodIndex = MOODS[inputs.mood] ? inputs.mood : 0;
  vm.mood = {
    kind: "enum",
    name: "mood",
    enum: MOOD_ENUM_NAME,
    value: moodName(moodIndex),
    index: moodIndex,
    values: MOODS,
  };
  boolean("stale", inputs.stale);
  boolean("paused", inputs.paused);
  boolean("gpu_online", inputs.gpu_online);
  number("season", num(inputs.season, 0));
  vm.headline_label = { kind: "string", name: "headline_label", value: typeof inputs.headline_label === "string" ? inputs.headline_label : "" };

  for (const [key, value] of Object.entries(inputs)) {
    if (key.startsWith("cosmetic_") && typeof value === "number" && Number.isFinite(value)) number(key, value);
  }
  return vm;
}

// ---------------------------------------------------------------------------
// Fallback, labels, motion
// ---------------------------------------------------------------------------

export function fallbackSrc(archetype: string, mood: string): string {
  const a = asArchetype(archetype);
  const m: MoodName = isMoodName(mood) ? mood : "asleep";
  return `/rigs/fallback/${a}-${m}.svg`;
}

/** No snapshot at all is rendered as the asleep pose: unknown, never distressed. */
export function offlineInputs(): RiveInputs {
  return {
    flow_pct: -1,
    snow_pct: -1,
    air_pct: -1,
    temp_pct: -1,
    alert_level: 0,
    drought: -1,
    mood: 0,
    stale: true,
    paused: false,
    gpu_online: true,
    season: 0,
    headline_label: "",
  };
}

export function moodOf(snapshot: HealthSnapshot | null | undefined): MoodName {
  return snapshot && isMoodName(snapshot.mood) ? snapshot.mood : "asleep";
}

export function moodReason(snapshot: HealthSnapshot | null | undefined): string {
  const reason = snapshot?.mood_reason?.trim();
  return reason && reason.length > 0 ? reason : states.cannotReachSenses;
}

/** "Flow: 15.4 cfs at Orodell, 2026-09-04 20:15Z, stale" — the anchor (first) need. */
export function headlineText(snapshot: HealthSnapshot | null | undefined): string | null {
  const anchor = snapshot?.needs[0];
  if (!anchor || !anchor.label) return null;
  const need = needLabel[anchor.need] ?? anchor.need;
  return `${need}: ${anchor.label}`;
}

/** §9.4: aria-label = mood_reason + the headline label. */
export function ariaLabel(snapshot: HealthSnapshot | null | undefined, name: string): string {
  const reason = moodReason(snapshot);
  const headline = headlineText(snapshot);
  const body = headline ? `${reason}. ${headline}` : reason;
  return name ? `${name} — ${body}` : body;
}

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** False on the server and wherever matchMedia is missing; never throws. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia(REDUCED_MOTION_QUERY).matches === true;
  } catch {
    return false;
  }
}
