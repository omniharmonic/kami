/**
 * Who may see the connect page, and who may mint.
 *
 * Two different questions, deliberately. Everyone with a role on a kami has a
 * reason to read the page — a guardian who signs its payouts should be able to
 * see which brain is attached to it, and what that brain is allowed to do. But
 * a token is a live credential for the entity's write tools, so minting and
 * rotating stay with the people who run the agent: the steward, the creator,
 * and a platform admin.
 *
 * Anyone else gets the public page. Not a 403 — there is nothing here they are
 * being kept out of that they would know to ask for, and `/e/<slug>` is the
 * page they meant.
 */
import { hasRole, type SessionUser } from "@/lib/session";

export type ConnectRole = "admin" | "steward" | "creator" | "guardian";

export type ConnectAccess = {
  may_view: boolean;
  may_mint: boolean;
  /** the strongest role held, for copy that names it */
  role: ConnectRole | null;
};

export const NO_ACCESS: ConnectAccess = { may_view: false, may_mint: false, role: null };

export type AccessEntity = { id: string; created_by?: string | null };

/** `may_mint` implies `may_view`; a guardian views without minting. */
export async function connectAccess(entity: AccessEntity, user: SessionUser | null | undefined): Promise<ConnectAccess> {
  if (!user) return NO_ACCESS;
  if (user.platform_admin) return { may_view: true, may_mint: true, role: "admin" };
  if (await hasRole(user.id, entity.id, "steward")) return { may_view: true, may_mint: true, role: "steward" };
  if (entity.created_by && entity.created_by === user.id) return { may_view: true, may_mint: true, role: "creator" };
  if (await hasRole(user.id, entity.id, "guardian")) return { may_view: true, may_mint: false, role: "guardian" };
  return NO_ACCESS;
}
