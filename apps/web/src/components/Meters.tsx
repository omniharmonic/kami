import type { HealthSnapshot } from "@kami/needs";
import { meters, needLabel, states } from "@/copy";

/**
 * One ring per need. The ring's arc is `health`; stale → grey dashed ring
 * labelled "can't feel it"; unbanded → dotted ring, value and trend only.
 * Value, unit, time and source are always present as text (§9.4).
 */
export function Meters({ snapshot }: { snapshot: HealthSnapshot | null }) {
  if (!snapshot) {
    return (
      <section className="section" aria-labelledby="meters-h">
        <h2 id="meters-h">{meters.heading}</h2>
        <p className="muted">{states.cannotReachSenses}</p>
      </section>
    );
  }
  return (
    <section className="section" aria-labelledby="meters-h">
      <h2 id="meters-h">{meters.heading}</h2>
      <ul className="meters">
        {snapshot.needs.map((n) => {
          const title = needLabel[n.need] ?? n.need;
          const unbanded = !n.stale && n.health === null;
          const cls = n.stale ? "ring ring-stale" : unbanded ? "ring ring-unbanded" : "ring";
          const pct = n.stale || n.health === null ? 0 : Math.round(n.health * 100);
          const r = 40;
          const c = 2 * Math.PI * r;
          return (
            <li key={`${n.need}-${n.property}`} className="meter card" data-need={n.need} data-stale={n.stale ? "true" : "false"}>
              <svg className={cls} viewBox="0 0 100 100" role="img" aria-label={meters.ringAria(title, n.label, n.stale)}>
                <circle className="ring-track" cx="50" cy="50" r={r} fill="none" strokeWidth="8" />
                <circle
                  className="ring-fill"
                  cx="50"
                  cy="50"
                  r={r}
                  fill="none"
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray={n.stale || unbanded ? undefined : `${(pct / 100) * c} ${c}`}
                  transform="rotate(-90 50 50)"
                />
                <text x="50" y="55" textAnchor="middle" fontSize="16" fill="currentColor">
                  {n.stale ? "—" : n.value === null ? "?" : formatValue(n.value)}
                </text>
              </svg>
              <h3 style={{ margin: "0 0 0.2rem", fontSize: "1rem" }}>{title}</h3>
              {n.stale && (
                <p className="chip chip-stale" style={{ margin: "0 auto 0.4rem" }}>
                  {states.cantFeelIt}
                </p>
              )}
              {!n.stale && n.health === null && (
                <p className="faint" style={{ margin: "0 0 0.4rem", fontSize: "0.78rem" }}>
                  {meters.unbanded}
                </p>
              )}
              <dl>
                <dt>{meters.reading}: </dt>
                <dd>{n.value === null ? meters.noReading : `${formatValue(n.value)} ${n.unit ?? ""}`.trim()}</dd>
                <dt>{meters.time}: </dt>
                <dd>
                  <time dateTime={n.time ?? undefined}>{n.time ?? "—"}</time>
                </dd>
                <dt>{meters.source}: </dt>
                <dd>
                  {n.source_id ?? "—"} ({n.source_status})
                </dd>
                {n.stale && n.staleness_s !== null && (
                  <>
                    <dt>{meters.stale}: </dt>
                    <dd>{meters.staleFor(n.staleness_s)}</dd>
                  </>
                )}
                {n.band && (
                  <>
                    <dt>band: </dt>
                    <dd>{n.band}</dd>
                  </>
                )}
                {n.trend_7d && (
                  <>
                    <dt>7d: </dt>
                    <dd>{meters.trend[n.trend_7d] ?? n.trend_7d}</dd>
                  </>
                )}
              </dl>
              {n.place_id && (
                <p className="faint" style={{ margin: "0.3rem 0 0", fontSize: "0.75rem", wordBreak: "break-all" }}>
                  {n.place_id}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Never rounds a reading away: integers as-is, otherwise one decimal (two below 1). */
function formatValue(v: number): string {
  if (Number.isInteger(v)) return String(v);
  return Math.abs(v) < 1 ? v.toFixed(2) : v.toFixed(1);
}
