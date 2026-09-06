/**
 * Per-entity platform tokens (`PLATFORM_MCP_TOKEN` in the profile's `.env`).
 *
 * Format `kami_<slug>_<48 hex>`: the slug is in the clear so verification
 * reads exactly one `config` row, and the secret half is 192 random bits. Only
 * a sha256 of the token is stored (`config.entity_tokens.<slug>`); minting
 * shows the token once. Compare with `timingSafeEqual`.
 */
import { createHash, randomBytes } from "node:crypto";
import type { DbOrTx } from "@/db/events";
import { deleteConfig, getConfig, safeEqual, setConfig } from "@/lib/jobs/common";

const TOKEN_RE = /^kami_([a-z0-9-]{1,64})_([0-9a-f]{48})$/;

export type StoredToken = { sha256: string; minted_at: string; rotated_from?: string | null };

export function tokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function slugFromToken(token: string): string | null {
  const m = TOKEN_RE.exec(token);
  return m ? m[1]! : null;
}

export function configKeyFor(slug: string): string {
  return `entity_tokens.${slug}`;
}

/** Create (or rotate) the token for `slug`. Returns the plaintext once; the DB keeps the hash. */
export async function mintEntityToken(db: DbOrTx, slug: string, now = new Date()): Promise<{ token: string; sha256: string }> {
  if (!/^[a-z0-9-]{1,64}$/.test(slug)) throw new TypeError(`bad slug: ${slug}`);
  const token = `kami_${slug}_${randomBytes(24).toString("hex")}`;
  const sha256 = tokenHash(token);
  const prior = await getConfig<StoredToken>(db, configKeyFor(slug));
  const stored: StoredToken = { sha256, minted_at: now.toISOString(), rotated_from: prior?.sha256 ?? null };
  await setConfig(db, configKeyFor(slug), stored, now);
  return { token, sha256 };
}

/** The slug a token is valid for, or null. */
export async function verifyEntityToken(db: DbOrTx, token: string | null | undefined): Promise<{ slug: string } | null> {
  if (!token) return null;
  const slug = slugFromToken(token);
  if (!slug) return null;
  const stored = await getConfig<StoredToken>(db, configKeyFor(slug));
  if (!stored || typeof stored.sha256 !== "string") return null;
  return safeEqual(tokenHash(token), stored.sha256) ? { slug } : null;
}

export async function revokeEntityToken(db: DbOrTx, slug: string): Promise<void> {
  await deleteConfig(db, configKeyFor(slug));
}
