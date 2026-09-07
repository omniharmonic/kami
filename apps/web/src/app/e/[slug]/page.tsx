import type { Metadata } from "next";
import Link from "next/link";
import { HabitatConsole } from "@/components/habitat/HabitatConsole";
import { SenseStrip } from "@/components/habitat/SenseStrip";
import { Board } from "@/components/Board";
import { ConnectLink } from "@/components/connect/ConnectLink";
import { Chat } from "@/components/Chat";
import { HowIWorkLink } from "@/components/HowIWorkLink";
import { Meters } from "@/components/Meters";
import { People } from "@/components/People";
import { PulseLog } from "@/components/PulseLog";
import { Siblings } from "@/components/Siblings";
import { Strategy } from "@/components/Strategy";
import { Treasury } from "@/components/Treasury";
import { chat as chatCopy, disclosure, errors } from "@/copy";
import {
  getBounties,
  getEntityBySlug,
  getHumanProposals,
  getPayouts,
  getPeople,
  getSiblings,
  getStatusCached,
  getStrategy,
} from "@/lib/entities";
import { getVisibleEntityDashboard } from "@/lib/entities-private";

export const revalidate = 60;

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const entity = await getEntityBySlug(slug);
  if (!entity) return { title: errors.notFound };
  const status = await getStatusCached(slug);
  const description = `${disclosure.short(entity.name)} ${status?.snapshot.mood_reason ?? ""}`.trim();
  return {
    title: entity.name,
    description,
    openGraph: { title: `${entity.name} · Kami`, description, images: [{ url: `/rigs/fallback/${entity.archetype}-${status?.snapshot.mood ?? "asleep"}.svg` }] },
  };
}

/** PRD §6.1 order: avatar + disclosure (layout) → chat → rings → strategy → board → treasury → people → siblings → how I work. */
export default async function EntityPage({ params }: Props) {
  const { slug } = await params;
  const { entity, status, snapshot } = await getVisibleEntityDashboard(slug);
  const [strategy, bounties, proposals, payouts, people, siblings] = await Promise.all([
    getStrategy(entity.id),
    getBounties(entity.id),
    getHumanProposals(entity.id),
    getPayouts(entity.id),
    getPeople(entity.id),
    getSiblings(entity.id),
  ]);
  return (
    <HabitatConsole tabs={[
      { id: "senses", label: "Senses", icon: "◉", detail: snapshot ? `${snapshot.needs.length} signals` : "Awaiting data", content: <>
        <div className="habitat-panel-intro"><div><h2>Small signals. A living watershed.</h2><p>Each sense is a measured observation. Missing or old data stays visible; it never becomes a health score.</p></div><Link className="btn" href={`/e/${entity.slug}/how-i-work`}>Read the evidence</Link></div>
        <SenseStrip snapshot={snapshot} />
        <p className="habitat-source-note">Open Evidence for every reading’s timestamp, unit, source and health band.</p>
      </> },
      { id: "chat", label: "Chat", icon: "✧", detail: entity.paused ? "Paused" : snapshot?.gpu_online ? "Connected" : "Offline", content: <section className="section" aria-labelledby="chat-h">
        <h2 id="chat-h">{chatCopy.title(entity.name)}</h2>
        <Chat slug={entity.slug} name={entity.name} archetype={entity.archetype} paused={entity.paused} gpuOnline={snapshot?.gpu_online ?? false} compact />
        <Link href={`/e/${entity.slug}/chat`} className="btn">{chatCopy.openFull}</Link>
      </section> },
      { id: "strategies", label: "Strategies", icon: "⌁", detail: strategy?.quarter ?? "Taking root", content: <><Strategy strategy={strategy} /><PulseLog pulses={status?.pulses ?? []} /><Link className="btn" href={`/e/${entity.slug}/how-i-work`}>How strategies are reviewed</Link></> },
      { id: "projects", label: "Projects", icon: "❀", detail: `${bounties.filter(b => b.status === "open").length} open bounties`, content: <>
        <div className="habitat-panel-intro"><div><h2>Care becomes action</h2><p>Explore bounties, propose work, and follow the evidence behind completed projects.</p></div></div>
        <Board bounties={bounties} proposals={proposals} summary={status?.board ?? null} entityId={entity.id} slug={entity.slug} />
      </> },
      { id: "treasury", label: "Treasury", icon: "◇", detail: status?.treasury?.balance_usdc ? `${status.treasury.balance_usdc} USDC` : "Balance unknown", content: <Treasury summary={status?.treasury ?? null} payouts={payouts} safeAddress={entity.safe_address} entityId={entity.id} slug={entity.slug} /> },
      { id: "community", label: "Community", icon: "♧", content: <><People roles={people} entityId={entity.id} /><Siblings siblings={siblings} /><ConnectLink entity={{ id: entity.id, slug: entity.slug }} /></> },
      { id: "evidence", label: "Evidence", icon: "≋", content: <><Meters snapshot={snapshot} /><HowIWorkLink slug={entity.slug} /></> },
    ]} />
  );
}
