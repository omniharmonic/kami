import Link from "next/link";
import type { Metadata } from "next";
import { landing } from "@/copy";
import { listPublicEntities } from "@/lib/entities";

export const revalidate = 300;

export const metadata: Metadata = { title: landing.title, description: landing.tagline };

export default async function Landing() {
  const entities = await listPublicEntities();
  return (
    <div className="stack" style={{ paddingTop: "1rem" }}>
      <section>
        <h1 style={{ fontSize: "2rem", margin: "0 0 0.4rem" }}>Kami</h1>
        <p className="muted" style={{ fontSize: "1.1rem", margin: 0 }}>{landing.tagline}</p>
      </section>

      <section className="section" aria-labelledby="ent-h">
        <h2 id="ent-h">{landing.entities}</h2>
        {entities.length === 0 ? (
          <p className="muted">{landing.entitiesEmpty}</p>
        ) : (
          <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {entities.map((e) => (
              <li key={e.slug} className="card">
                <Link href={`/e/${e.slug}`} style={{ fontWeight: 600, fontSize: "1.1rem" }}>
                  {e.name}
                </Link>
                <p className="faint" style={{ margin: "0.2rem 0 0" }}>
                  an AI voice for the {e.archetype}
                  {e.paused ? " · paused by its guardians" : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="section" aria-labelledby="what-h">
        <h2 id="what-h">{landing.whatIs}</h2>
        {landing.whatIsBody.map((p) => (
          <p key={p}>{p}</p>
        ))}
      </section>

      <section className="section card" aria-labelledby="notoken-h">
        <h2 id="notoken-h" style={{ marginTop: 0 }}>{landing.noToken}</h2>
        <p style={{ margin: 0 }}>{landing.noTokenBody}</p>
      </section>

      <p className="faint" style={{ fontSize: "0.9rem" }}>{landing.attribution}</p>
    </div>
  );
}
