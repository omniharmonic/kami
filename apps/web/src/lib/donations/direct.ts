/**
 * The direct-USDC rail (architecture §7.6): the Safe address and a QR, offered
 * as an equal alternative to the card. Incoming transfers are read from the
 * Safe Transaction Service (`listIncomingTransfers`, *verify* docs/verify.md #7)
 * by the donor-report job or the poll cron and written as
 * `donations rail = 'usdc_direct'`.
 *
 * A direct donation is **anonymous by default**. It is attributed to a person
 * only when they sign "this was me" from the sending wallet and viem's
 * `verifyMessage` agrees — a claim from any other address is refused.
 *
 * `donations` has no column for the sending address (schema gap), so the
 * sender and the log index live in `config.direct_donation.<donation id>`,
 * which is what `claimDirectDonation` reads.
 */
import { and, eq, isNotNull } from "drizzle-orm";
import { getAddress, isAddress, verifyMessage, type Address, type Hex } from "viem";
import { listIncomingTransfers } from "@kami/chain";
import type { Db, DbOrTx } from "@/db/events";
import { appendEntityEvent } from "@/db/events";
import * as schema from "@/db/schema";
import { getConfig, setConfig } from "@/lib/jobs/common";
import type { TreasuryDeps } from "@/lib/treasury/deps";
import { round2 } from "./fees";

export const DIRECT_CONFIG_PREFIX = "direct_donation.";

/** Everything the page needs to show the "send USDC yourself" alternative. */
export type DirectDonationTarget = {
  safe_address: string | null;
  chain_id: number;
  chain_name: string;
  token: { symbol: "USDC"; address: string; decimals: 6 };
  /** a data: URL, rendered server-side; null when there is no Safe yet */
  qr_data_url: string | null;
};

/**
 * QR of the plain checksummed address — the form every wallet accepts. An
 * EIP-681 `ethereum:<addr>@<chainId>/transfer?address=…` payload would also
 * prefill the token and is *verify* against the wallets guardians actually use.
 */
export async function safeQrDataUrl(address: string): Promise<string | null> {
  if (!address || !isAddress(address)) return null;
  const { toDataURL } = await import("qrcode");
  return toDataURL(getAddress(address), { errorCorrectionLevel: "M", margin: 1, width: 240 });
}

export async function directDonationTarget(deps: TreasuryDeps, safeAddress: string | null | undefined): Promise<DirectDonationTarget> {
  const addr = safeAddress && isAddress(safeAddress) ? getAddress(safeAddress) : null;
  return {
    safe_address: addr,
    chain_id: deps.chain.chainId,
    chain_name: deps.chain.name,
    token: { symbol: "USDC", address: deps.chain.usdc.address, decimals: 6 },
    qr_data_url: addr ? await safeQrDataUrl(addr) : null,
  };
}

// ---------------------------------------------------------------------------
// polling
// ---------------------------------------------------------------------------

export type IncomingTransfer = {
  transactionHash: string;
  from: string;
  to: string;
  value: string;
  tokenAddress: string | null;
  executionDate: string | null;
  logIndex: number | null;
  type: string | null;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** Defensive parse of one Transaction Service transfer record (*verify* shape). */
export function parseTransfer(raw: unknown): IncomingTransfer | null {
  if (!isRecord(raw)) return null;
  const hash = typeof raw.transactionHash === "string" ? raw.transactionHash : null;
  const from = typeof raw.from === "string" ? raw.from : null;
  const to = typeof raw.to === "string" ? raw.to : null;
  const value = typeof raw.value === "string" ? raw.value : typeof raw.value === "number" ? String(raw.value) : null;
  if (!hash || !from || !to || value === null) return null;
  const li = raw.logIndex;
  return {
    transactionHash: hash,
    from,
    to,
    value,
    tokenAddress: typeof raw.tokenAddress === "string" ? raw.tokenAddress : null,
    executionDate: typeof raw.executionDate === "string" ? raw.executionDate : null,
    logIndex: typeof li === "number" ? li : typeof li === "string" && li !== "" && Number.isFinite(Number(li)) ? Number(li) : null,
    type: typeof raw.type === "string" ? raw.type : null,
  };
}

/** `don_usdc_<24 hex of tx>_<log index>` — a repeat insert collides on the primary key. */
export function directDonationId(txHash: string, logIndex: number | null): string {
  const h = txHash.replace(/^0x/, "").slice(0, 24).toLowerCase();
  return `don_usdc_${h}_${logIndex ?? 0}`;
}

export type PollResult = {
  entity: string;
  checked: number;
  recorded: Array<{ donation_id: string; amount_usdc: string; tx_hash: string; from: string }>;
  skipped: number;
  error?: string;
};

/**
 * Read incoming USDC transfers to one entity's Safe and record the ones we
 * have not seen. Nothing is attributed to a donor here.
 */
export async function pollDirectDonations(
  db: Db,
  deps: TreasuryDeps,
  entity: typeof schema.entities.$inferSelect,
): Promise<PollResult> {
  const out: PollResult = { entity: entity.slug, checked: 0, recorded: [], skipped: 0 };
  if (!entity.safeAddress || !isAddress(entity.safeAddress)) return out;
  const safe = getAddress(entity.safeAddress);
  const usdc = deps.chain.usdc.address.toLowerCase();

  let raw: unknown[];
  try {
    raw = await listIncomingTransfers({ apiKit: deps.apiKit(), safeAddress: safe });
  } catch (err) {
    out.error = (err as Error).message.slice(0, 160);
    deps.log(`incoming transfers unavailable for ${entity.slug}: ${out.error}`);
    return out;
  }

  for (const item of raw) {
    const t = parseTransfer(item);
    if (!t) continue;
    out.checked += 1;
    if (!t.tokenAddress || t.tokenAddress.toLowerCase() !== usdc) {
      out.skipped += 1;
      continue;
    }
    let units: bigint;
    try {
      units = BigInt(t.value);
    } catch {
      out.skipped += 1;
      continue;
    }
    if (units <= 0n) {
      out.skipped += 1;
      continue;
    }
    const amount = round2(Number(units) / 1e6).toFixed(2);
    const id = directDonationId(t.transactionHash, t.logIndex);
    const at = t.executionDate ? new Date(t.executionDate) : deps.now();
    const inserted = await db
      .insert(schema.donations)
      .values({
        id,
        entityId: entity.id,
        donorUserId: null,
        rail: "usdc_direct",
        gross: amount,
        fee: "0.00",
        net: amount,
        currency: "usdc",
        chainTxHash: t.transactionHash,
        receivedAt: at,
      })
      .onConflictDoNothing()
      .returning({ id: schema.donations.id });
    if (inserted.length === 0) {
      out.skipped += 1;
      continue;
    }
    await setConfig(
      db,
      `${DIRECT_CONFIG_PREFIX}${id}`,
      { from: getAddress(t.from), tx_hash: t.transactionHash, log_index: t.logIndex, token: t.tokenAddress, value_raw: t.value, entity_id: entity.id, chain_id: deps.chain.chainId },
      deps.now(),
    );
    await appendEntityEvent(db, {
      entity_id: entity.id,
      actor: "chain",
      kind: "donation.recorded",
      payload: { donation_id: id, rail: "usdc_direct", amount_usdc: amount, tx_hash: t.transactionHash, from: getAddress(t.from), attributed: false },
      at,
    });
    out.recorded.push({ donation_id: id, amount_usdc: amount, tx_hash: t.transactionHash, from: getAddress(t.from) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// "this was me"
// ---------------------------------------------------------------------------

/**
 * The exact text a donor signs. It names the transaction so a signature cannot
 * be replayed onto another donation, and says plainly what it does.
 */
export function directDonationMessage(txHash: string, chainId: number): string {
  return [
    "Kami — this was me.",
    "",
    `I sent the USDC in transaction ${txHash.toLowerCase()} on chain ${chainId}.`,
    "Attribute that donation to my Kami account. Signing costs nothing and moves no money.",
  ].join("\n");
}

export type ClaimRefusal = {
  ok: false;
  code: "not_found" | "already_claimed" | "wrong_signer" | "no_sender_on_record" | "bad_signature";
  message: string;
  status: 404 | 409 | 422;
};

export type ClaimResult = { ok: true; donation_id: string; entity_id: string; amount_usdc: string | null; signer: Address } | ClaimRefusal;

type DirectRecord = { from?: string; tx_hash?: string; chain_id?: number; entity_id?: string };

async function donationByTxHash(db: DbOrTx, txHash: string) {
  const [row] = await db
    .select()
    .from(schema.donations)
    .where(and(eq(schema.donations.rail, "usdc_direct"), eq(schema.donations.chainTxHash, txHash)))
    .limit(1);
  return row ?? null;
}

/**
 * Attribute a direct donation to `userId` when `signature` over
 * `directDonationMessage` verifies against the address that actually sent the
 * USDC. Any other address is refused; nothing is written on refusal.
 */
export async function claimDirectDonation(
  db: Db,
  deps: TreasuryDeps,
  input: { txHash: string; signature: string; userId: string },
): Promise<ClaimResult> {
  const txHash = input.txHash.trim();
  const donation = await donationByTxHash(db, txHash);
  if (!donation) return { ok: false, code: "not_found", message: "No direct donation with that transaction hash has been recorded yet.", status: 404 };
  if (donation.donorUserId) {
    return donation.donorUserId === input.userId
      ? { ok: true, donation_id: donation.id, entity_id: donation.entityId ?? "", amount_usdc: donation.net, signer: getAddress((await getConfig<DirectRecord>(db, `${DIRECT_CONFIG_PREFIX}${donation.id}`))?.from ?? "0x0000000000000000000000000000000000000000") }
      : { ok: false, code: "already_claimed", message: "That donation is already attributed to someone.", status: 409 };
  }

  const rec = await getConfig<DirectRecord>(db, `${DIRECT_CONFIG_PREFIX}${donation.id}`);
  const from = rec?.from;
  if (!from || !isAddress(from)) {
    return { ok: false, code: "no_sender_on_record", message: "We have no sending address on record for that transfer, so nothing can be checked against it.", status: 422 };
  }
  const sender = getAddress(from);
  const chainId = rec?.chain_id ?? deps.chain.chainId;
  const message = directDonationMessage(txHash, chainId);

  let valid = false;
  try {
    valid = await verifyMessage({ address: sender, message, signature: input.signature as Hex });
  } catch {
    return { ok: false, code: "bad_signature", message: "That signature could not be read.", status: 422 };
  }
  if (!valid) {
    deps.log(`direct-donation claim refused for ${donation.id}: signature is not from ${sender}`);
    return { ok: false, code: "wrong_signer", message: "That signature is not from the wallet the USDC came from, so the donation stays anonymous.", status: 422 };
  }

  await db.update(schema.donations).set({ donorUserId: input.userId }).where(eq(schema.donations.id, donation.id));
  if (donation.entityId) {
    await appendEntityEvent(db, {
      entity_id: donation.entityId,
      actor: input.userId,
      kind: "donation.attributed",
      payload: { donation_id: donation.id, tx_hash: txHash, signer: sender, rail: "usdc_direct" },
      at: deps.now(),
    });
  }
  return { ok: true, donation_id: donation.id, entity_id: donation.entityId ?? "", amount_usdc: donation.net, signer: sender };
}

/** Direct donations still without a donor, for the "was this you?" prompt. */
export async function unattributedDirectDonations(db: DbOrTx, entityId: string) {
  return db
    .select({ id: schema.donations.id, net: schema.donations.net, txHash: schema.donations.chainTxHash, receivedAt: schema.donations.receivedAt })
    .from(schema.donations)
    .where(and(eq(schema.donations.entityId, entityId), eq(schema.donations.rail, "usdc_direct"), isNotNull(schema.donations.chainTxHash)));
}
