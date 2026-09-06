import type { HealthSnapshot } from "@kami/needs";
import { states } from "@/copy";

export type AvatarProps = {
  snapshot: HealthSnapshot | null;
  /** needed for the fallback path; not part of the snapshot */
  archetype: string;
  name: string;
};

/**
 * Placeholder avatar: the static SVG fallback per archetype × mood
 * (architecture §9.4). Another agent replaces the internals with the Rive
 * runtime; keep the props. Accessibility: role="img" with aria-label =
 * mood_reason + the headline (first) need's label.
 */
export function Avatar({ snapshot, archetype, name }: AvatarProps) {
  const mood = snapshot?.mood ?? "asleep";
  const reason = snapshot?.mood_reason ?? states.cannotReachSenses;
  const headline = snapshot?.needs[0]?.label ?? "";
  const label = `${name}: ${reason}${headline ? ` — ${headline}` : ""}`;
  const src = `/rigs/fallback/${safe(archetype)}-${safe(mood)}.svg`;
  return (
    <figure className="avatar-wrap" style={{ margin: 0 }} data-mood={mood} data-stale={snapshot?.stale_driving ? "true" : "false"}>
      <img src={src} alt="" role="img" aria-label={label} width={240} height={240} />
      <figcaption className="muted" style={{ fontSize: "0.9rem" }}>
        {reason}
      </figcaption>
    </figure>
  );
}

function safe(s: string): string {
  return /^[a-z]+$/.test(s) ? s : "creek";
}
