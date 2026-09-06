import { EntityShell } from "@/components/EntityShell";
import { entityPage } from "@/copy";
import { getStatusCached } from "@/lib/entities";
import { requireVisibleEntity } from "@/lib/entity-access";

export const revalidate = 60;

/**
 * Every /e/[slug]/* route is wrapped in EntityShell — the ADR-E13 invariant.
 *
 * The consultation gate (PRD §13 #4) is `requireVisibleEntity`, and it is
 * called here *and* in every child segment that renders entity content: a
 * layout's `notFound()` sets the status but does not stop a concurrently
 * streaming page from putting its output in the response. See
 * `lib/entity-access.ts`.
 */
export default async function EntityLayout({ params, children }: { params: Promise<{ slug: string }>; children: React.ReactNode }) {
  const { slug } = await params;
  const { entity, preview } = await requireVisibleEntity(slug);
  const status = await getStatusCached(slug);

  return (
    <EntityShell
      entity={{ slug: entity.slug, name: entity.name, archetype: entity.archetype, paused: entity.paused }}
      snapshot={status?.snapshot ?? null}
      asOf={status?.as_of ?? null}
    >
      {preview ? (
        <p className="notice" role="status" data-testid="consultation-preview">
          {entityPage.consultationPreview}
        </p>
      ) : null}
      {children}
    </EntityShell>
  );
}
