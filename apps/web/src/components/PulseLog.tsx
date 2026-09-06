import type { PulseEntry } from "@/lib/status";
import { pulse } from "@/copy";

export function PulseLog({ pulses }: { pulses: PulseEntry[] }) {
  const woke = pulses.filter((p) => p.woke);
  return (
    <section className="section" aria-labelledby="pulse-h">
      <h2 id="pulse-h">{pulse.heading}</h2>
      {woke.length === 0 ? (
        <p className="muted">{pulse.empty}</p>
      ) : (
        <ol className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {woke.slice(0, 10).map((p) => (
            <li key={p.at} className="card">
              <time dateTime={p.at} className="eyebrow">
                {p.at}
              </time>
              <p style={{ margin: "0.3rem 0 0" }} data-generated="ai">
                {p.text}
              </p>
              {p.deltas && p.deltas.length > 0 && (
                <ul className="faint" style={{ fontSize: "0.8rem", margin: "0.4rem 0 0", paddingLeft: "1rem" }}>
                  {p.deltas.map((d, i) => (
                    <li key={i}>
                      {d.need ?? "snapshot"} · {d.field}: {String(d.from)} → {String(d.to)}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
