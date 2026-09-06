"use server";

/**
 * The two mutations `/me/wallet` needs. Both are session-gated; neither ever
 * touches key material.
 *
 * `linkWallet` takes a Privy access token from the browser, verifies it
 * server-side, and stores `privy_did` + `wallet_address` (ADR-E07). It
 * deliberately does not trust an address sent by the client: the address comes
 * back from Privy, keyed by the DID inside the verified token.
 */
import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { claimDirectDonation } from "@/lib/donations/direct";
import { getTreasuryDeps } from "@/lib/treasury/deps";
import { disconnectWallet, getOrCreateWallet, getPrivyServer, verifyPrivyToken } from "@/lib/privy/server";
import { getSession } from "@/lib/session";

export type LinkResult = { ok: boolean; address?: string | null; message?: string };

export async function linkWallet(token: string): Promise<LinkResult> {
  const session = await getSession();
  if (!session) return { ok: false, message: "Please sign in first." };
  const db = getDb();
  if (!db) return { ok: false, message: "The database is unavailable; nothing was changed." };

  const privy = await getPrivyServer();
  const verified = await verifyPrivyToken(token, { privy });
  if (!verified.ok) return { ok: false, message: verified.message };

  const result = await getOrCreateWallet(db, { privy, did: verified.did }, session.user.id);
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath("/me/wallet");
  return { ok: true, address: result.wallet.wallet_address };
}

export async function forgetWallet(): Promise<{ ok: boolean }> {
  const session = await getSession();
  if (!session) return { ok: false };
  const db = getDb();
  if (!db) return { ok: false };
  await disconnectWallet(db, session.user.id);
  revalidatePath("/me/wallet");
  return { ok: true };
}

/**
 * "This was me": attribute a direct USDC donation to the signed-in person when
 * the sending wallet signs `directDonationMessage`. A signature from any other
 * address is refused and the donation stays anonymous.
 */
export async function claimDonation(txHash: string, signature: string): Promise<{ ok: boolean; message?: string; donation_id?: string }> {
  const session = await getSession();
  if (!session) return { ok: false, message: "Please sign in first." };
  const db = getDb();
  if (!db) return { ok: false, message: "The database is unavailable; nothing was changed." };
  const r = await claimDirectDonation(db, getTreasuryDeps(), { txHash, signature, userId: session.user.id });
  if (!r.ok) return { ok: false, message: r.message };
  revalidatePath("/me/wallet");
  return { ok: true, donation_id: r.donation_id };
}
