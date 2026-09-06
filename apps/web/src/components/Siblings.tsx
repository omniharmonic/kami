import Link from "next/link";
import { siblings } from "@/copy";

export type SiblingView = { slug: string; name: string; archetype: string };

export function Siblings({ siblings: list }: { siblings: SiblingView[] }) {
  return (
    <section className="section" aria-labelledby="siblings-h">
      <h2 id="siblings-h">{siblings.heading}</h2>
      <p className="muted" style={{ marginTop: 0 }}>{siblings.intro}</p>
      {list.length === 0 ? (
        <p className="muted">{siblings.empty}</p>
      ) : (
        <ul style={{ paddingLeft: "1.2rem" }}>
          {list.map((s) => (
            <li key={s.slug}>
              <Link href={`/e/${s.slug}`} className="tap" style={{ paddingInline: 0 }}>
                {s.name}
              </Link>{" "}
              <span className="faint">({s.archetype})</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
