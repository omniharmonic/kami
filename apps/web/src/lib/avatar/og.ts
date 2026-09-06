/**
 * The data the OG card renders, computed once so the route and its test share it.
 */
import type { Status } from "@/lib/status";
import { disclosureLabel, moodLabel } from "@/copy";
import { headlineText, moodOf, moodReason } from "./inputs";
import { asArchetype } from "./rigs";

export type OgCardModel = {
  name: string;
  archetype: string;
  mood: string;
  moodWord: string;
  reason: string;
  headline: string | null;
  disclosure: string;
  asOf: string | null;
};

export function titleFromSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function ogCardModel(status: Status | null, slug: string): OgCardModel {
  const name = status?.entity?.name ?? titleFromSlug(slug);
  const archetype = asArchetype(status?.entity?.archetype ?? "creek");
  const snapshot = status?.snapshot ?? null;
  const mood = moodOf(snapshot);
  return {
    name,
    archetype,
    mood,
    moodWord: moodLabel[mood] ?? mood,
    reason: moodReason(snapshot),
    headline: headlineText(snapshot),
    disclosure: disclosureLabel(name, archetype),
    asOf: status?.as_of ?? null,
  };
}
