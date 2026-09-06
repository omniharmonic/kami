import { notFound } from "next/navigation";
import { EntityShell } from "@/components/EntityShell";
import { entityPage } from "@/copy";
import { getEntityBySlug, getStatusCached } from "@/lib/entities";
import { getSession, hasRole } from "@/lib/session";

export const revalidate = 60;

/**
 * PRD §13 #4: an entity's page is not public until a steward has recorded that
 * consultation happened. The needs job withholds `status.json` for the same
 * reason, so an unconsulted entity has no published readings either; this is
 * the second half, keeping the pages themselves unreadable by the public.
 *
 * Anyone holding a role on the entity — steward, guardian, evaluator — sees it
 * anyway, with a banner, because they are the people who have to look at it in
 * order to finish the consultation.
 */
async function mayPreview(entityId: string): Promise<boolean> {
  const session = await getSession();
  if (!session) return false;
  const user = session.user;
  if (user.platform_admin) return true;
  for (const role of ["steward", "guardian", "evaluator"] as const) {
    if (await hasRole(user.id, entityId, role)) return true;
  }
  return false;
}

/** Every /e/[slug]/* route is wrapped in EntityShell — the ADR-E13 invariant. */
export default async function EntityLayout({ params, children }: { params: Promise<{ slug: string }>; children: React.ReactNode }) {
  const { slug } = await params;
  const entity = await getEntityBySlug(slug);
  if (!entity) notFound();
  const status = await getStatusCached(slug);

  // `from_db` is false when the entity is rendered from a published status file
  // alone; publication is then already evidence that a steward released it.
  const unpublished = entity.from_db && entity.consultation_done_at === null;
  const preview = unpublished ? await mayPreview(entity.id) : false;
  if (unpublished && !preview) notFound();

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
