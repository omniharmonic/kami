import type { Metadata } from "next";
import Link from "next/link";
import { Chat } from "@/components/Chat";
import { chat as copy, errors } from "@/copy";
import { getEntityBySlug, getStatusCached } from "@/lib/entities";
import { requireVisibleEntity } from "@/lib/entity-access";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const entity = await getEntityBySlug(slug);
  return { title: entity ? copy.title(entity.name) : errors.notFound, robots: { index: false } };
}

export default async function ChatPage({ params }: Props) {
  const { slug } = await params;
  const { entity } = await requireVisibleEntity(slug);
  const status = await getStatusCached(slug);
  return (
    <section className="section" aria-labelledby="chat-h" style={{ minHeight: "60dvh" }}>
      <h2 id="chat-h">{copy.title(entity.name)}</h2>
      <Chat slug={entity.slug} name={entity.name} archetype={entity.archetype} paused={entity.paused} gpuOnline={status?.snapshot.gpu_online ?? true} />
      <p style={{ marginTop: "1rem" }}>
        <Link href={`/e/${entity.slug}`} className="btn">{copy.backToPage(entity.name)}</Link>
      </p>
    </section>
  );
}
