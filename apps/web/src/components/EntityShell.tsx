import Link from "next/link";
import type { HealthSnapshot } from "@kami/needs";
import { Avatar } from "./Avatar";
import { DisclosureLabel } from "./DisclosureLabel";
import { nav, states } from "@/copy";

export type EntityShellProps = {
  entity: { slug: string; name: string; archetype: string; paused: boolean };
  snapshot: HealthSnapshot | null;
  asOf: string | null;
  children: React.ReactNode;
};

/**
 * The entity layout. Renders the avatar slot, then the disclosure label
 * directly under it and above everything else (ADR-E13). Every `/e/[slug]/*`
 * route is wrapped in this; a render test asserts the label text is present.
 */
export function EntityShell({ entity, snapshot, asOf, children }: EntityShellProps) {
  return (
    <article data-entity={entity.slug}>
      <header>
        <h1 style={{ textAlign: "center", margin: "0.5rem 0 0", fontSize: "1.6rem" }}>{entity.name}</h1>
        <Avatar snapshot={snapshot} archetype={entity.archetype} name={entity.name} />
        <DisclosureLabel name={entity.name} archetype={entity.archetype} />
        <p className="faint" style={{ fontSize: "0.8rem", textAlign: "center", margin: "0.4rem 0 0" }}>
          {asOf ? <time dateTime={asOf}>{states.asOf(asOf)}</time> : states.cannotReachSenses}
          {entity.paused && <> · {states.asleepPaused}</>}
        </p>
        <nav aria-label="Entity sections" style={{ display: "flex", gap: "0.5rem", justifyContent: "center", flexWrap: "wrap", marginTop: "0.5rem" }}>
          <Link href={`/e/${entity.slug}`} className="btn">Home</Link>
          <Link href={`/e/${entity.slug}/chat`} className="btn">{nav.chat}</Link>
          <Link href={`/e/${entity.slug}/how-i-work`} className="btn">{nav.howIWork}</Link>
        </nav>
      </header>
      {children}
    </article>
  );
}
