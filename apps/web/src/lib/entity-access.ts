/**
 * Who may see an entity that has not been published yet.
 *
 * The gate lives here rather than in the layout because **a layout's
 * `notFound()` does not stop the page from rendering.** Under streaming both
 * segments render concurrently; the response carries a 404 status and the
 * error shell, but the page component's output is still serialized into the
 * RSC flight payload, where `curl` can read it. Found on the first live
 * deployment: `GET /e/boulder-creek` answered 404 and its body contained the
 * entity's sections, the People list among them.
 *
 * So every route segment under `/e/[slug]` that renders entity content calls
 * `requireVisibleEntity` itself. `getEntityBySlug` is wrapped in React `cache`,
 * so the second call in a request is free.
 *
 * One residue is deliberate and left alone: `generateMetadata` still resolves,
 * so a refused request's `<title>` carries the entity's display name. The
 * requester already had to know the slug to ask, and slugs come from public
 * place names, so this discloses nothing the URL did not. Everything with
 * substance behind it — readings, guardians, bounties, treasury — is gated.
 */
import { notFound } from "next/navigation";
import { getEntityBySlug, type EntityView } from "@/lib/entities";
import { getSession, hasRole } from "@/lib/session";

export const PREVIEW_ROLES = ["steward", "guardian", "evaluator"] as const;

/**
 * A role-holder — or a platform admin — sees an unpublished entity anyway, with
 * a banner, because they are the people who have to look at it in order to
 * prepare the entity for publication.
 */
export async function mayPreview(entityId: string): Promise<boolean> {
  const session = await getSession();
  if (!session) return false;
  const user = session.user;
  if (user.platform_admin) return true;
  for (const role of PREVIEW_ROLES) {
    if (await hasRole(user.id, entityId, role)) return true;
  }
  return false;
}

export type VisibleEntity = {
  entity: EntityView;
  /** true when the viewer is seeing an unpublished entity by virtue of a role */
  preview: boolean;
};

/**
 * The entity, or `notFound()`. `preview` is true when it is only visible
 * because the viewer holds a role on it — the caller renders the banner.
 *
 * `from_db` is false when an entity is rendered from a published status file
 * alone; publication is then already evidence that a steward released it.
 */
export async function requireVisibleEntity(slug: string): Promise<VisibleEntity> {
  const entity = await getEntityBySlug(slug);
  if (!entity) notFound();
  const unpublished = entity.from_db && !entity.published_at;
  if (!unpublished) return { entity, preview: false };
  if (await mayPreview(entity.id)) return { entity, preview: true };
  notFound();
}
