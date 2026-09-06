import { summon } from "@/lib/summon/copy";
import type { SensingRow } from "@/lib/summon/sensing";

const STATE_CHIP: Record<string, { className: string; label: string }> = {
  live: { className: "chip chip-live", label: summon.sensing.live },
  stale: { className: "chip chip-stale", label: summon.sensing.stale },
  missing: { className: "chip", label: summon.sensing.missing },
};

/**
 * What the kami would be able to sense today, per need — with the gaps named
 * (PRD §12 #1). Colour never carries meaning alone: every state is a word.
 */
export function SensingTable({ rows, gaps }: { rows: SensingRow[]; gaps: string[] }) {
  return (
    <section className="section" aria-labelledby="sensing-h">
      <h3 id="sensing-h" style={{ fontSize: "1rem" }}>{summon.place.senseHeading}</h3>
      <p className="muted" style={{ marginTop: 0 }}>{summon.place.senseIntro}</p>
      {rows.length === 0 ? (
        <p className="muted">{summon.place.unreachable}</p>
      ) : (
        <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {rows.map((r) => {
            const chip = STATE_CHIP[r.state] ?? STATE_CHIP.missing!;
            return (
              <li key={`${r.need}-${r.property}`} className="sunken">
                <p style={{ margin: 0, fontWeight: 600 }}>
                  {r.need} <span className="faint" style={{ fontWeight: 400 }}>· {r.property}</span>{" "}
                  <span className={chip.className}>{chip.label}</span>
                </p>
                <p className="muted" style={{ margin: "0.2rem 0 0", fontSize: "0.9rem" }}>
                  {r.where.length > 0 ? r.where.join(", ") : "—"}
                  {r.value !== null ? ` · ${r.value}${r.unit ? ` ${r.unit}` : ""}` : ""}
                  {r.time ? ` · ${r.time}` : ""}
                </p>
                <p className="faint" style={{ margin: "0.2rem 0 0", fontSize: "0.85rem" }}>{r.note}</p>
              </li>
            );
          })}
        </ul>
      )}
      {gaps.length > 0 ? (
        <div className="card" style={{ marginTop: "0.75rem" }}>
          <p className="eyebrow" style={{ margin: 0 }}>{summon.place.gapsHeading}</p>
          <ul style={{ margin: "0.35rem 0 0", paddingLeft: "1.2rem" }}>
            {gaps.map((g) => (
              <li key={g} className="muted" style={{ fontSize: "0.9rem" }}>{g}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
