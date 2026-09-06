/**
 * The scoped bearer token, from the page's point of view.
 *
 * There is one token scheme on this platform (`src/lib/mcp/tokens.ts`:
 * `kami_<slug>_<48 hex>`, sha256 stored, compared with `timingSafeEqual`) and
 * this module does not invent a second one. It adds only what a screen needs:
 *
 * - **what may be shown afterwards.** The platform keeps a hash, not a token,
 *   so it *cannot* redisplay one even if a page asked. What it can show is the
 *   public prefix (`kami_<slug>_`, which is in every request's Authorization
 *   header anyway), the age, and eight characters of the stored sha256 as a
 *   fingerprint — enough to tell two tokens apart in a runbook, useless as a
 *   credential.
 * - **the fact that minting again is a rotation.** `mintEntityToken` overwrites
 *   the stored hash, so the previous token stops working the moment the new one
 *   is written. That is the whole warning the page has to make loud.
 */
import type { DbOrTx } from "@/db/events";
import { appendEntityEvent } from "@/db/events";
import { getConfig } from "@/lib/jobs/common";
import { configKeyFor, mintEntityToken, type StoredToken } from "@/lib/mcp/tokens";

export type TokenState = {
  slug: string;
  /** a token exists for this entity */
  exists: boolean;
  /** `kami_<slug>_` — public; the secret half is never stored and never shown again */
  prefix: string;
  /** first 8 hex of the stored sha256; null when no token exists */
  fingerprint: string | null;
  minted_at: string | null;
  /** seconds since it was minted; null when unknown (absent, never zero) */
  age_s: number | null;
  /** true when this token replaced an earlier one */
  rotated: boolean;
};

export function tokenPrefix(slug: string): string {
  return `kami_${slug}_`;
}

export async function tokenState(db: DbOrTx, slug: string, now: Date = new Date()): Promise<TokenState> {
  const stored = await getConfig<StoredToken>(db, configKeyFor(slug));
  const prefix = tokenPrefix(slug);
  if (!stored || typeof stored.sha256 !== "string") {
    return { slug, exists: false, prefix, fingerprint: null, minted_at: null, age_s: null, rotated: false };
  }
  const mintedAt = typeof stored.minted_at === "string" ? stored.minted_at : null;
  const t = mintedAt ? Date.parse(mintedAt) : NaN;
  return {
    slug,
    exists: true,
    prefix,
    fingerprint: stored.sha256.slice(0, 8),
    minted_at: mintedAt,
    age_s: Number.isFinite(t) ? Math.max(0, Math.round((now.getTime() - t) / 1000)) : null,
    rotated: Boolean(stored.rotated_from),
  };
}

export type MintOutcome = {
  /** the plaintext token — the only time it exists outside the agent's environment */
  token: string;
  state: TokenState;
  /** true when an earlier token was invalidated by this call */
  replaced: boolean;
};

/**
 * Mint or rotate, and write it into the entity's own audit log. The event
 * carries the fingerprint and the actor — never the token.
 */
export async function mintConnectToken(db: DbOrTx, entity: { id: string; slug: string }, actor: string | null, now: Date = new Date()): Promise<MintOutcome> {
  const before = await tokenState(db, entity.slug, now);
  const { token, sha256 } = await mintEntityToken(db, entity.slug, now);
  await appendEntityEvent(db, {
    entity_id: entity.id,
    actor,
    kind: before.exists ? "mcp_token.rotated" : "mcp_token.minted",
    payload: { fingerprint: sha256.slice(0, 8), replaced_fingerprint: before.fingerprint, prefix: tokenPrefix(entity.slug) },
    at: now,
  });
  return { token, state: await tokenState(db, entity.slug, now), replaced: before.exists };
}
