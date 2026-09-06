/**
 * Plurality, rendered (PRD §4.4, §13 #10).
 *
 * Many kami for one place are allowed and expected. This section says so in
 * words — "<place> has more than one voice. None of them speaks for it
 * alone." — and shows who tends each sibling, because the steward, the
 * guardians and the soul are the whole difference between them. They share
 * the readings.
 *
 * It renders in two places: the entity page (siblings of an existing kami)
 * and step 1 of the summon flow, *before* a creator invests any effort.
 */
import Link from "next/link";
import { siblings as copy } from "@/copy";
import { summon } from "@/lib/summon/copy";
import type { SiblingEntity } from "@/lib/summon/siblings";

/** The shape the entity page has always passed; the richer fields are optional. */
export type SiblingView = {
  slug: string;
  name: string;
  archetype: string;
  steward?: { name: string } | null;
  guardians?: Array<{ name: string }>;
  paused?: boolean;
};

export type SiblingsProps = {
  siblings: SiblingView[] | SiblingEntity[];
  /** the place they share, for the plurality line; falls back to the shared copy */
  placeName?: string | null;
  /** step 1 shows this before anything is chosen */
  heading?: string;
};

function People({ s }: { s: SiblingView }) {
  const guardians = s.guardians ?? [];
  if (!s.steward && guardians.length === 0) return null;
  return (
    <dl className="faint" style={{ margin: "0.2rem 0 0", fontSize: "0.85rem", display: "flex", flexWrap: "wrap", gap: "0 1rem" }}>
      {s.steward ? (
        <div>
          <dt style={{ display: "inline" }}>{summon.siblings.steward}: </dt>
          <dd style={{ display: "inline", margin: 0 }}>{s.steward.name}</dd>
        </div>
      ) : null}
      <div>
        <dt style={{ display: "inline" }}>{summon.siblings.guardians}: </dt>
        <dd style={{ display: "inline", margin: 0 }}>
          {guardians.length > 0 ? guardians.map((g) => g.name).join(", ") : summon.siblings.noGuardians}
        </dd>
      </div>
    </dl>
  );
}

export function Siblings({ siblings: list, placeName, heading }: SiblingsProps) {
  const rows = list as SiblingView[];
  return (
    <section className="section" aria-labelledby="siblings-h">
      <h2 id="siblings-h">{heading ?? copy.heading}</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        {placeName ? summon.siblings.plurality(placeName) : copy.intro}
      </p>
      {placeName ? <p className="muted" style={{ marginTop: "-0.4rem" }}>{summon.siblings.intro}</p> : null}
      {rows.length === 0 ? (
        <p className="muted">{copy.empty}</p>
      ) : (
        <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {rows.map((s) => (
            <li key={s.slug} className="sunken">
              <Link href={`/e/${s.slug}`} className="tap" style={{ paddingInline: 0, fontWeight: 600 }}>
                {s.name}
              </Link>{" "}
              <span className="faint">({s.archetype})</span>
              {s.paused ? <span className="chip chip-stale" style={{ marginLeft: "0.5rem" }}>paused</span> : null}
              <People s={s} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
