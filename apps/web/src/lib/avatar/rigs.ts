/**
 * Rig manifest — which commissioned Rive rig exists for which archetype
 * (architecture §9.4, implementation plan T1.8 / T3.4).
 *
 * All rigs are `available: false` today: the commission is out (rive/BRIEF.md)
 * and the SVG fallback under public/rigs/fallback is authoritative until a
 * `.riv` lands under public/rigs/<archetype>/<version>/<archetype>.riv and the
 * archetype passes the dev checklist at /dev/rig/<archetype>.
 *
 * The names below are the contract with the artist (rive/INPUT-CONTRACT.md).
 */

export const ARCHETYPES = ["creek", "mountain", "reservoir", "watershed", "bioregion"] as const;
export type Archetype = (typeof ARCHETYPES)[number];

/** Index = the §9.2 `mood` enum value (0 asleep … 4 celebrating). */
export const MOODS = ["asleep", "content", "concerned", "distressed", "celebrating"] as const;
export type MoodName = (typeof MOODS)[number];

/** State machine every rig must expose. */
export const STATE_MACHINE = "Mood";
/** ViewModel every rig must expose (default instance is bound). */
export const VIEW_MODEL = "Kami";
/** The Rive data enum backing the `mood` property, values in MOODS order. */
export const MOOD_ENUM_NAME = "Mood";

export type RigEntry = { version: string; available: boolean };

export const rigManifest: Record<Archetype, RigEntry> = {
  creek: { version: "v0", available: false },
  mountain: { version: "v0", available: false },
  reservoir: { version: "v0", available: false },
  watershed: { version: "v0", available: false },
  bioregion: { version: "v0", available: false },
};

export function isArchetype(x: unknown): x is Archetype {
  return typeof x === "string" && (ARCHETYPES as readonly string[]).includes(x);
}

export function isMoodName(x: unknown): x is MoodName {
  return typeof x === "string" && (MOODS as readonly string[]).includes(x);
}

/** Unknown archetypes fall back to the creek rig/SVG rather than to nothing. */
export function asArchetype(x: string): Archetype {
  return isArchetype(x) ? x : "creek";
}

export function rigSrc(archetype: Archetype, version: string): string {
  return `/rigs/${archetype}/${version}/${archetype}.riv`;
}

export type RigInfo = { archetype: Archetype; version: string; available: boolean; src: string };

export function rigFor(archetype: string, manifest: Record<Archetype, RigEntry> = rigManifest): RigInfo {
  const a = asArchetype(archetype);
  const entry = manifest[a];
  return { archetype: a, version: entry.version, available: entry.available, src: rigSrc(a, entry.version) };
}
