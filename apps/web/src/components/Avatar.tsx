import type { HealthSnapshot } from "@kami/needs";
import { moodLabel } from "@/copy";
import { ariaLabel, moodOf, moodReason, offlineInputs, snapshotToRiveInputs } from "@/lib/avatar/inputs";
import { RiveAvatar } from "./avatar/RiveAvatar";

export type AvatarProps = {
  snapshot: HealthSnapshot | null;
  /** needed for the rig and the fallback path; not part of the snapshot */
  archetype: string;
  name: string;
};

/**
 * The kami's avatar (architecture §9, ADR-E09/E11). Server-safe: computes the
 * §9.2 inputs from the snapshot and hands them to the client stage, which
 * renders the SVG first and the Rive rig when one is available.
 *
 * Accessibility (§9.4, X.5): role="img" with aria-label = mood_reason + the
 * headline need's label, and the mood word + mood_reason as visible text so
 * colour never carries the state alone. No snapshot → asleep, never distressed.
 */
export function Avatar({ snapshot, archetype, name }: AvatarProps) {
  const inputs = snapshot ? snapshotToRiveInputs(snapshot) : offlineInputs();
  const mood = moodOf(snapshot);
  const reason = moodReason(snapshot);
  const label = ariaLabel(snapshot, name);
  return (
    <figure className="avatar-wrap" style={{ margin: 0 }} data-mood={mood} data-stale={inputs.stale ? "true" : "false"}>
      <RiveAvatar archetype={archetype} inputs={inputs} label={label} />
      <figcaption className="muted" style={{ fontSize: "0.9rem", textAlign: "center" }}>
        <span className={inputs.stale ? "chip chip-stale" : "chip"} data-testid="mood-word">
          {moodLabel[mood] ?? mood}
        </span>{" "}
        <span data-testid="mood-reason">{reason}</span>
      </figcaption>
    </figure>
  );
}
