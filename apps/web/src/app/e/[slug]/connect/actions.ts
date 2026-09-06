"use server";

/**
 * Minting and rotating, as server actions.
 *
 * Both are the same call — `mintEntityToken` overwrites the stored hash — so
 * the difference between "mint" and "rotate" is entirely about consequence, and
 * that difference is enforced here rather than in the component: a rotation
 * that arrives without the confirmation checkbox is refused. A client that
 * skips the warning still cannot skip the confirmation.
 *
 * The plaintext token is returned to the caller and to nowhere else. It is not
 * written to a cookie, not put in a URL, and not logged. The database keeps a
 * sha256, so this reply is the only place it will ever exist outside the
 * agent's environment.
 */
import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { entityBySlug, slugOk } from "@/lib/jobs/common";
import { connectAccess } from "@/lib/connect/access";
import { mintConnectToken, tokenState } from "@/lib/connect/token";
import { getSession } from "@/lib/session";
import type { MintFormState } from "@/components/connect/TokenPanel";

export async function mintConnectTokenAction(_prev: MintFormState, formData: FormData): Promise<MintFormState> {
  const slug = String(formData.get("slug") ?? "");
  if (!slugOk(slug)) return { ok: false, error: "not_found" };

  const db = getDb();
  if (!db) return { ok: false, error: "no_db" };

  const entity = await entityBySlug(db, slug);
  if (!entity) return { ok: false, error: "not_found" };

  const session = await getSession();
  const access = await connectAccess({ id: entity.id, created_by: entity.createdBy }, session?.user ?? null);
  if (!access.may_mint) return { ok: false, error: "forbidden" };

  // Rotation is destructive to a running agent, so it needs the box ticked.
  const before = await tokenState(db, slug);
  if (before.exists && formData.get("confirm") !== "yes") return { ok: false, error: "confirm_required" };

  const outcome = await mintConnectToken(db, { id: entity.id, slug: entity.slug }, session?.user.id ?? null);
  revalidatePath(`/e/${slug}/connect`);
  return { ok: true, token: outcome.token, replaced: outcome.replaced };
}
