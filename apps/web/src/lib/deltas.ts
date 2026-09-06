/**
 * What changed between two snapshots, and whether it is worth waking the
 * model (architecture §5.3, plan T1.4). The classification itself lives in
 * `@kami/needs` (`classifyDeltas`); this module fixes the platform's reading
 * of it:
 *
 *   notable   band_change · alert_start · alert_end · stale_flip · mood_change
 *   quiet     value_change (the number moved inside its band)
 *
 * A pulse with no notable delta posts `woke: true` with no text; the precheck
 * already spared the tokens when nothing at all changed (`snapshotHash`).
 */
import { classifyDeltas, hasNotableDelta, type Delta, type DeltaKind, type HealthSnapshot } from "@kami/needs";

export { classifyDeltas, hasNotableDelta };
export type { Delta, DeltaKind };

export const NOTABLE_KINDS: readonly DeltaKind[] = ["band_change", "alert_start", "alert_end", "stale_flip", "mood_change"];

export function isNotableKind(kind: DeltaKind): boolean {
  return NOTABLE_KINDS.includes(kind);
}

/** `classifyDeltas` with the first-snapshot case folded in: nothing to compare against → no deltas. */
export function deltasSince(prev: HealthSnapshot | null | undefined, next: HealthSnapshot): Delta[] {
  if (!prev) return [];
  return classifyDeltas(prev, next).map((d) => ({ ...d, notable: isNotableKind(d.kind) }));
}

export function notableOnly(deltas: readonly Delta[]): Delta[] {
  return deltas.filter((d) => d.notable);
}

/** A templated one-liner per delta for logs and the commons roll-up — never for the model. */
export function describeDelta(d: Delta): string {
  const subject = d.need ?? "mood";
  switch (d.kind) {
    case "stale_flip":
      return d.to === true ? `${subject}: gauge went quiet` : `${subject}: gauge came back`;
    case "alert_start":
      return `alerts: an alert started (level ${String(d.to)})`;
    case "alert_end":
      return `alerts: the alert ended`;
    case "band_change":
      return `${subject}: ${d.field} ${String(d.from)} → ${String(d.to)}`;
    case "mood_change":
      return `mood: ${String(d.from)} → ${String(d.to)}`;
    case "value_change":
    default:
      return `${subject}: value ${String(d.from)} → ${String(d.to)}`;
  }
}
