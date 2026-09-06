/**
 * Step 2 — archetype and parts (PRD §6.2, architecture §9.3; rig contract in
 * `rive/INPUT-CONTRACT.md`).
 *
 * The rule this module exists to enforce: **cosmetics are the only thing a
 * person ever chooses, and they are earned by human action, never by data.**
 * A part is unlocked by a completed bounty, a drill, a season tended — never
 * by a reading, and never by money. `entities.rive_config` therefore holds
 * only choices; every unlockable part carries the human act that unlocks it,
 * so the flow can say so out loud.
 */
import { ARCHETYPES, rigFor, type Archetype } from "@/lib/avatar/rigs";

export type PartOption = {
  id: string;
  label: string;
  /** null = available to everyone from the start */
  earned_by: string | null;
};

export type PartSlot = {
  key: string;
  label: string;
  options: PartOption[];
};

export type ColourOption = { id: string; label: string; hex: string };

/** Eight swappable slots, the number the rig brief commissions (PRD §6.2). */
export const PART_SLOTS: PartSlot[] = [
  {
    key: "body",
    label: "Body",
    options: [
      { id: "round", label: "Round", earned_by: null },
      { id: "long", label: "Long", earned_by: null },
      { id: "braided", label: "Braided", earned_by: null },
    ],
  },
  {
    key: "eyes",
    label: "Eyes",
    options: [
      { id: "wide", label: "Wide", earned_by: null },
      { id: "narrow", label: "Narrow", earned_by: null },
      { id: "closed", label: "Half-closed", earned_by: null },
    ],
  },
  {
    key: "brow",
    label: "Brow",
    options: [
      { id: "soft", label: "Soft", earned_by: null },
      { id: "straight", label: "Straight", earned_by: null },
    ],
  },
  {
    key: "mouth",
    label: "Mouth",
    options: [
      { id: "small", label: "Small", earned_by: null },
      { id: "wide", label: "Wide", earned_by: null },
    ],
  },
  {
    key: "hat",
    label: "Hat",
    options: [
      { id: "none", label: "None", earned_by: null },
      { id: "field", label: "Field hat", earned_by: null },
      { id: "hard", label: "Hard hat", earned_by: "worn after a guardian runs the first pause drill" },
      { id: "ranger", label: "Ranger hat", earned_by: "worn after five bounties are completed and attested" },
    ],
  },
  {
    key: "companion",
    label: "Companion",
    options: [
      { id: "none", label: "None", earned_by: null },
      { id: "dipper", label: "Dipper", earned_by: "worn after a contributor submits in-app photographs that pass evaluation" },
      { id: "heron", label: "Heron", earned_by: "worn after a full year of tending" },
    ],
  },
  {
    key: "marking",
    label: "Marking",
    options: [
      { id: "none", label: "None", earned_by: null },
      { id: "stones", label: "Stones", earned_by: null },
      { id: "ripples", label: "Ripples", earned_by: null },
    ],
  },
  {
    key: "backdrop",
    label: "Backdrop",
    options: [
      { id: "plain", label: "Plain", earned_by: null },
      { id: "canyon", label: "Canyon", earned_by: null },
      { id: "plains", label: "Plains", earned_by: null },
    ],
  },
];

export const COLOURS: ColourOption[] = [
  { id: "creek", label: "Creek blue", hex: "#2f6f8f" },
  { id: "moss", label: "Moss", hex: "#4f7d4a" },
  { id: "sandstone", label: "Sandstone", hex: "#b8743a" },
  { id: "snow", label: "Snow", hex: "#dbe9f0" },
  { id: "granite", label: "Granite", hex: "#5d554b" },
];

export type RiveConfig = {
  archetype: Archetype;
  rig_version: string;
  parts: Record<string, string>;
  colour: string;
  /**
   * Parts a person has actually earned. Empty at summon: nothing is unlocked
   * by creating a kami, and nothing is ever unlocked by a reading.
   */
  unlocked: string[];
};

export function defaultRiveConfig(archetype: string): RiveConfig {
  const rig = rigFor(archetype);
  return {
    archetype: rig.archetype,
    rig_version: rig.version,
    parts: Object.fromEntries(PART_SLOTS.map((s) => [s.key, s.options[0]!.id])),
    colour: COLOURS[0]!.id,
    unlocked: [],
  };
}

export function isEarned(slotKey: string, optionId: string): boolean {
  const opt = PART_SLOTS.find((s) => s.key === slotKey)?.options.find((o) => o.id === optionId);
  return Boolean(opt?.earned_by);
}

/**
 * Coerce a form/JSON payload into a `rive_config`. Unknown slots and unknown
 * options fall back to the default; an option that must be earned is refused
 * unless it is in `unlocked` — a creator cannot pick their way to a hat.
 */
export function normalizeRiveConfig(input: unknown, archetype: string, unlocked: string[] = []): RiveConfig {
  const base = defaultRiveConfig(archetype);
  const raw = (input && typeof input === "object" ? (input as Record<string, unknown>) : {}) as Record<string, unknown>;
  const rawParts = (raw.parts && typeof raw.parts === "object" ? (raw.parts as Record<string, unknown>) : raw) as Record<string, unknown>;
  const parts: Record<string, string> = { ...base.parts };
  for (const slot of PART_SLOTS) {
    const chosen = rawParts[slot.key];
    if (typeof chosen !== "string") continue;
    const option = slot.options.find((o) => o.id === chosen);
    if (!option) continue;
    if (option.earned_by && !unlocked.includes(`${slot.key}:${option.id}`)) continue;
    parts[slot.key] = option.id;
  }
  const colour = typeof raw.colour === "string" && COLOURS.some((c) => c.id === raw.colour) ? (raw.colour as string) : base.colour;
  const chosenArchetype = typeof raw.archetype === "string" ? raw.archetype : archetype;
  const rig = rigFor(chosenArchetype);
  return { archetype: rig.archetype, rig_version: rig.version, parts, colour, unlocked: [...unlocked] };
}

export const ARCHETYPE_OPTIONS = ARCHETYPES.map((a) => ({ id: a, label: a[0]!.toUpperCase() + a.slice(1) }));
