import type { Metadata } from "next";
import Link from "next/link";
import { Board } from "@/components/Board";
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
  const entity = (await getEntityBySlug(slug))!;
  const status = await getStatusCached(slug);
  const [strategy, bounties, proposals, payouts, people, siblings] = await Promise.all([
    getStrategy(entity.id),
    getBounties(entity.id),
    getHumanProposals(entity.id),
    getPayouts(entity.id),
    getPeople(entity.id),
    getSiblings(entity.id),
  ]);
  return (
    <>
      <section className="section" aria-labelledby="chat-h">
        <h2 id="chat-h">{chatCopy.title(entity.name)}</h2>
        <Chat slug={entity.slug} name={entity.name} archetype={entity.archetype} paused={entity.paused} gpuOnline={status?.snapshot.gpu_online ?? true} compact />
        <p style={{ marginTop: "0.5rem" }}>
          <Link href={`/e/${entity.slug}/chat`} className="btn">{chatCopy.openFull}</Link>
        </p>
      </section>
      <Meters snapshot={status?.snapshot ?? null} />
      <PulseLog pulses={status?.pulses ?? []} />
      <Strategy strategy={strategy} />
      <Board bounties={bounties} proposals={proposals} summary={status?.board ?? null} />
      <Treasury summary={status?.treasury ?? null} payouts={payouts} safeAddress={entity.safe_address} />
      <People roles={people} />
      <Siblings siblings={siblings} />
      <HowIWorkLink slug={entity.slug} />
    </>
  );
}
