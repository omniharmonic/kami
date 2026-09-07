import type { Metadata } from "next";
import Link from "next/link";
import { Chat } from "@/components/Chat";
import { chat as copy, errors } from "@/copy";
import { getEntityBySlug } from "@/lib/entities";
import { getVisibleEntityDashboard } from "@/lib/entities-private";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const entity = await getEntityBySlug(slug);
  return { title: entity ? copy.title(entity.name) : errors.notFound, robots: { index: false } };
}

export default async function ChatPage({ params }: Props) {
  const { slug } = await params;
  const { entity, snapshot } = await getVisibleEntityDashboard(slug);
  return (
    <section className="section habitat-chat-room" aria-labelledby="chat-h">
      <h2 id="chat-h">{copy.title(entity.name)}</h2>
      <Chat slug={entity.slug} name={entity.name} archetype={entity.archetype} paused={entity.paused} gpuOnline={snapshot?.gpu_online ?? false} />
      <p style={{ marginTop: "1rem" }}>
        <Link href={`/e/${entity.slug}`} className="btn">{copy.backToPage(entity.name)}</Link>
      </p>
    </section>
  );
}
