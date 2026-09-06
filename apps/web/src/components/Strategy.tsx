import { strategy } from "@/copy";

export type StrategyView = { quarter: string; memo_md: string; comment_open_until: string | null } | null;

/** Three bullets from the ratified quarterly memo; empty state until one exists. */
export function Strategy({ strategy: s }: { strategy: StrategyView }) {
  const bullets = s ? s.memo_md.split("\n").filter((l) => /^\s*[-*]\s+/.test(l)).slice(0, 3).map((l) => l.replace(/^\s*[-*]\s+/, "")) : [];
  return (
    <section className="section" aria-labelledby="strategy-h">
      <h2 id="strategy-h">{strategy.heading}</h2>
      {!s ? (
        <p className="muted">{strategy.empty}</p>
      ) : (
        <div className="card" data-generated="ai">
          <p className="eyebrow" style={{ margin: 0 }}>
            {s.quarter}
          </p>
          <ul>{bullets.length ? bullets.map((b, i) => <li key={i}>{b}</li>) : <li>{s.memo_md.slice(0, 280)}</li>}</ul>
          {s.comment_open_until && <p className="faint">{strategy.commentOpen(s.comment_open_until)}</p>}
        </div>
      )}
    </section>
  );
}
