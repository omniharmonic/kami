import type { HealthSnapshot } from "@kami/needs";
import { needLabel } from "@/copy";

export function SenseStrip({ snapshot }: { snapshot: HealthSnapshot | null }) {
  if (!snapshot?.needs.length) return <p className="habitat-senses-empty">Senses appear here when a reviewed snapshot is ready.</p>;
  return <ul className="habitat-sense-strip" aria-label="Ecological senses summary">{snapshot.needs.map((need) => {
    const label = needLabel[need.need] ?? need.need;
    const known = !need.stale && need.health !== null;
    return <li key={`${need.need}-${need.property}`} data-stale={need.stale}>
      <span>{label}</span><strong>{need.stale ? "Stale" : need.value === null ? "Unknown" : `${Number(need.value.toPrecision(4))} ${need.unit ?? ""}`}</strong>
      <span className="habitat-sense-track" aria-hidden="true"><span style={{ width: known ? `${Math.max(0, Math.min(100, need.health! * 100))}%` : "0%" }} /></span>
      <small>{need.stale ? "Needs a fresh reading" : known ? need.band ?? "Published health band" : "No health band"}</small>
    </li>;
  })}</ul>;
}
