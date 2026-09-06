/**
 * The T1.8 acceptance checklist — the same list the commissioning brief
 * (rive/BRIEF.md §7) carries. The dev page at /dev/rig/<archetype> renders it
 * with checkboxes; a rig is "live" when every box is ticked for its archetype.
 */
export type ChecklistItem = { id: string; text: string };

export const RIG_CHECKLIST: readonly ChecklistItem[] = [
  { id: "moods", text: "Five moods — asleep, content, concerned, distressed, celebrating — each a distinct pose at a glance." },
  { id: "asleep-listening", text: "Asleep reads as listening for a quiet gauge (closed eyes, attentive) — never sad, never a sleep-of-exhaustion." },
  { id: "stale-not-distressed", text: "stale=true is visibly distinct from distressed, in colour and in greyscale (grey family, its own pose)." },
  { id: "seasons", text: "Four seasons (0 freeze, 1 runoff, 2 monsoon, 3 fall) change the scene and palette, not the face." },
  { id: "absent", text: "Number inputs at −1 (absent) render as 'unknown' — never as an empty or zero meter." },
  { id: "alert-drought", text: "alert_level 0–3 and drought 0–4 change scene details without changing the mood pose." },
  { id: "headline", text: "headline_label binds to a text run and wraps at two lines without overflowing the artboard." },
  { id: "cosmetics", text: "Each cosmetic_* slot swaps its part; 0 shows nothing; unknown values fall back to 0." },
  { id: "paused-gpu", text: "paused=true and gpu_online=false share the asleep pose, each with its own small cue." },
  { id: "reduced-motion", text: "Reduced-motion rest pose: with the state machine not started, the artboard shows the correct mood pose." },
  { id: "performance", text: "60 fps on a mid-range phone; .riv ≤ 250 KB; no image assets, vectors only." },
  { id: "no-colour-only", text: "Colour never carries meaning alone (greyscale check passes for every mood)." },
  { id: "forbidden", text: "Nothing forbidden: no death, no crying rivers, no shrine or religious iconography, nothing implying legal standing." },
];

export function checklistStorageKey(archetype: string): string {
  return `kami:rig-checklist:${archetype}`;
}
