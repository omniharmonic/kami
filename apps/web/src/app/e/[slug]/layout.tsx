import { notFound } from "next/navigation";
import { EntityShell } from "@/components/EntityShell";
import { getEntityBySlug, getStatusCached } from "@/lib/entities";

export const revalidate = 60;

/** Every /e/[slug]/* route is wrapped in EntityShell — the ADR-E13 invariant. */
export default async function EntityLayout({ params, children }: { params: Promise<{ slug: string }>; children: React.ReactNode }) {
  const { slug } = await params;
  const entity = await getEntityBySlug(slug);
  if (!entity) notFound();
  const status = await getStatusCached(slug);
  return (
    <EntityShell
      entity={{ slug: entity.slug, name: entity.name, archetype: entity.archetype, paused: entity.paused }}
      snapshot={status?.snapshot ?? null}
      asOf={status?.as_of ?? null}
    >
      {children}
    </EntityShell>
  );
}
