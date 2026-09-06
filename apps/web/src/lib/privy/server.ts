/**
 * Privy, server side (ADR-E07, architecture §6.5).
 *
 * Privy is **not** the identity provider: Better Auth's magic link is. Privy is
 * a wallet provider keyed by our user id, and the whole reconciliation surface
 * is two columns — `users.privy_did` and `users.wallet_address`. The platform
 * verifies a Privy access token, reads the address, and stores it. It never
 * holds, requests, exports or logs a user key, and there is no code path here
 * that could.
 *
 * A wallet is created lazily: only when a person claims a bounty, accepts
 * guardianship, or opens `/me/wallet` (the three surfaces ADR-E07 names).
 */
import { eq } from "drizzle-orm";
import { getAddress, isAddress } from "viem";
import type { Db, DbOrTx } from "@/db/events";
import * as schema from "@/db/schema";
import { privyConfigured, privyEnv, type PrivyEnv } from "./env";

export type PrivyClaims = { userId: string; appId?: string; sessionId?: string; issuedAt?: number; expiration?: number };
export type PrivyWallet = { address: string; chainType?: string; walletClientType?: string };
export type PrivyUser = { id: string; wallet?: PrivyWallet | undefined };

/** The slice of `@privy-io/server-auth` this module uses, so tests inject a fake. */
export interface PrivyServerLike {
  verifyAuthToken(token: string, verificationKeyOverride?: string): Promise<PrivyClaims>;
  getUserById(userId: string): Promise<PrivyUser>;
  createWallets(input: { userId: string; createEthereumWallet?: boolean }): Promise<PrivyUser>;
}

let cached: PrivyServerLike | null | undefined;

export async function getPrivyServer(env: PrivyEnv = privyEnv()): Promise<PrivyServerLike | null> {
  if (cached !== undefined) return cached;
  if (!privyConfigured(env)) return (cached = null);
  const { PrivyClient } = await import("@privy-io/server-auth");
  return (cached = new PrivyClient(env.PRIVY_APP_ID!, env.PRIVY_APP_SECRET!) as unknown as PrivyServerLike);
}

/** Test seam. */
export function setPrivyServerForTests(p: PrivyServerLike | null | undefined): void {
  cached = p;
}

// ---------------------------------------------------------------------------
// token verification
// ---------------------------------------------------------------------------

export type VerifyResult =
  | { ok: true; did: string; claims: PrivyClaims }
  | { ok: false; code: "not_configured" | "no_token" | "invalid_token"; message: string; status: 400 | 401 | 503 };

export async function verifyPrivyToken(token: string | null | undefined, deps: { privy: PrivyServerLike | null; env?: PrivyEnv }): Promise<VerifyResult> {
  if (!deps.privy) return { ok: false, code: "not_configured", message: "Wallets are not switched on for this deployment.", status: 503 };
  if (!token) return { ok: false, code: "no_token", message: "No Privy access token.", status: 400 };
  const key = (deps.env ?? privyEnv()).PRIVY_VERIFICATION_KEY;
  try {
    const claims = key ? await deps.privy.verifyAuthToken(token, key) : await deps.privy.verifyAuthToken(token);
    if (!claims?.userId) return { ok: false, code: "invalid_token", message: "That token carries no Privy user.", status: 401 };
    return { ok: true, did: claims.userId, claims };
  } catch {
    // never echo the token or the error detail
    return { ok: false, code: "invalid_token", message: "That token did not verify.", status: 401 };
  }
}

// ---------------------------------------------------------------------------
// lazy wallet
// ---------------------------------------------------------------------------

export type WalletRecord = { user_id: string; privy_did: string | null; wallet_address: string | null; created: boolean };

export type WalletRefusal = { ok: false; code: "not_configured" | "user_not_found" | "did_taken" | "privy_error" | "no_address"; message: string; status: 401 | 404 | 409 | 502 | 503 };

export type WalletResult = { ok: true; wallet: WalletRecord } | WalletRefusal;

export async function readWallet(db: DbOrTx, userId: string): Promise<WalletRecord | null> {
  const [u] = await db
    .select({ id: schema.users.id, did: schema.users.privyDid, address: schema.users.walletAddress })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!u) return null;
  return { user_id: u.id, privy_did: u.did, wallet_address: u.address, created: false };
}

/**
 * The lazy path. With a stored address it returns it and touches nothing.
 * Otherwise it asks Privy for this person's wallet, creating one if they have
 * none, and stores `privy_did` + `wallet_address`. No key ever crosses this
 * boundary — Privy holds it and the person controls it.
 */
export async function getOrCreateWallet(
  db: Db,
  deps: { privy: PrivyServerLike | null; did?: string | null; log?: (l: string) => void },
  userId: string,
): Promise<WalletResult> {
  const log = deps.log ?? ((l: string) => console.log(`[privy] ${l}`));
  const existing = await readWallet(db, userId);
  if (!existing) return { ok: false, code: "user_not_found", message: "No such user.", status: 404 };
  if (existing.wallet_address) return { ok: true, wallet: existing };
  if (!deps.privy) return { ok: false, code: "not_configured", message: "Wallets are not switched on for this deployment.", status: 503 };

  const did = deps.did ?? existing.privy_did;
  if (!did) {
    return { ok: false, code: "not_configured", message: "Sign in to the wallet provider once first; this page does that for you.", status: 401 };
  }

  // A DID may belong to exactly one Kami account (`users.privy_did` is unique).
  const [other] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.privyDid, did)).limit(1);
  if (other && other.id !== userId) {
    return { ok: false, code: "did_taken", message: "That wallet account is already linked to a different Kami account.", status: 409 };
  }

  let user: PrivyUser;
  try {
    user = await deps.privy.getUserById(did);
    if (!user.wallet?.address) user = await deps.privy.createWallets({ userId: did, createEthereumWallet: true });
  } catch (err) {
    log(`wallet provisioning failed for ${userId}: ${(err as Error).message.slice(0, 160)}`);
    return { ok: false, code: "privy_error", message: "The wallet provider did not answer. Nothing was changed.", status: 502 };
  }

  const raw = user.wallet?.address;
  if (!raw || !isAddress(raw)) return { ok: false, code: "no_address", message: "The wallet provider returned no usable address.", status: 502 };
  const address = getAddress(raw);

  await db.update(schema.users).set({ privyDid: did, walletAddress: address, updatedAt: new Date() }).where(eq(schema.users.id, userId));
  log(`wallet linked for ${userId}: ${address}`);
  return { ok: true, wallet: { user_id: userId, privy_did: did, wallet_address: address, created: true } };
}

/** Detach the wallet from this account. Privy keeps the wallet; we forget the link. */
export async function disconnectWallet(db: Db, userId: string): Promise<{ ok: true }> {
  await db.update(schema.users).set({ privyDid: null, walletAddress: null, updatedAt: new Date() }).where(eq(schema.users.id, userId));
  return { ok: true };
}

/** The off-ramp link shown beside an address (*verify* docs/verify.md #14). */
export function offrampUrl(configured: string | null | undefined, env: PrivyEnv = privyEnv()): string | null {
  const raw = configured ?? env.OFFRAMP_URL ?? null;
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}
