import Link from "next/link";
import type { HealthSnapshot } from "@kami/needs";
import { EntityHabitat } from "./explore/EntityHabitat";
import { Avatar } from "./Avatar";
import { DisclosureLabel } from "./DisclosureLabel";
import { nav, states } from "@/copy";
import { habitatPhrase } from "@/copy/habitat";

export type EntityShellProps = {
  entity: { slug: string; name: string; archetype: string; paused: boolean; longitude?: number; latitude?: number };
  snapshot: HealthSnapshot | null;
  asOf: string | null;
  children: React.ReactNode;
};

/** Persistent habitat. Disclosure stays after the avatar and before every route's content. */
export function EntityShell({ entity, snapshot, asOf, children }: EntityShellProps) {
  return (
    <article data-entity={entity.slug} className="habitat-shell">
      <EntityHabitat name={entity.name} kind={entity.archetype} slug={entity.slug} mood={snapshot?.mood ?? "asleep"} longitude={entity.longitude} latitude={entity.latitude} />
      <header className="habitat-identity">
        <Link href="/" className="habitat-back">‹ Return to the living world</Link>
        <h1>{entity.name}</h1>
        <div className="habitat-specimen"><Avatar snapshot={snapshot} archetype={entity.archetype} name={entity.name} /></div>
        <DisclosureLabel name={entity.name} archetype={entity.archetype} />
        <p className="habitat-timestamp">{asOf ? <time dateTime={asOf}>{states.asOf(asOf)}</time> : states.cannotReachSenses}
          {entity.paused && <span>{states.asleepPaused}</span>}
        </p>
        <nav aria-label="Entity sections" className="habitat-route-nav">
          <Link href={`/e/${entity.slug}`}>My home</Link>
          <Link href={`/e/${entity.slug}/chat`}>{nav.chat}</Link>
          <Link href={`/e/${entity.slug}/how-i-work`}>{nav.howIWork}</Link>
        </nav>
      </header>
      <div className="habitat-scene-space"><p className="habitat-phrase"><span aria-hidden="true">✧</span> {habitatPhrase(snapshot, entity.paused)}</p></div>
      <div className="entity-content habitat-content">{children}</div>
    </article>
  );
}
