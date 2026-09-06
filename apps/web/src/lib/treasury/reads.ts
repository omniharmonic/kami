/**
 * The two reads the keyless treasury MCP makes: Safe USDC balance (viem
 * `balanceOf`, cached 60 s; `null` with a reason when the RPC is down — never
 * a made-up zero) and the pending proposals with live confirmation counts.
 */
import { and, eq } from "drizzle-orm";
import { ERC20_ABI, getConfirmations } from "@kami/chain";
import { formatUnits, getAddress, isAddress, type Address, type Hex } from "viem";
import type { DbOrTx } from "@/db/events";
import * as schema from "@/db/schema";
import type { TreasuryDeps } from "./deps";

export const BALANCE_TTL_MS = 60_000;

export type BalanceRead =
  | { balance_usdc: string; balance_raw: string; as_of: string; cached: boolean; chain_id: number; safe_address: Address; usdc: Address }
  | { balance_usdc: null; reason: "no_safe" | "rpc_unavailable"; detail?: string; chain_id: number; safe_address: Address | null };

const cache = new Map<string, { raw: bigint; at: number }>();

export function clearBalanceCache(): void {
  cache.clear();
}

export async function readSafeBalance(deps: TreasuryDeps, safeAddress: string | null | undefined): Promise<BalanceRead> {
  const chain_id = deps.chain.chainId;
  if (!safeAddress || !isAddress(safeAddress)) return { balance_usdc: null, reason: "no_safe", chain_id, safe_address: null };
  const safe = getAddress(safeAddress);
  const key = `${chain_id}:${safe}`;
  const now = deps.now().getTime();
  const hit = cache.get(key);
  if (hit && now - hit.at < BALANCE_TTL_MS) {
    return { balance_usdc: formatUnits(hit.raw, 6), balance_raw: hit.raw.toString(), as_of: new Date(hit.at).toISOString(), cached: true, chain_id, safe_address: safe, usdc: deps.chain.usdc.address };
  }
  try {
    const raw = (await deps.publicClient().readContract({ address: deps.chain.usdc.address, abi: ERC20_ABI, functionName: "balanceOf", args: [safe] })) as bigint;
    cache.set(key, { raw, at: now });
    return { balance_usdc: formatUnits(raw, 6), balance_raw: raw.toString(), as_of: new Date(now).toISOString(), cached: false, chain_id, safe_address: safe, usdc: deps.chain.usdc.address };
  } catch (err) {
    return { balance_usdc: null, reason: "rpc_unavailable", detail: (err as Error).message.slice(0, 160), chain_id, safe_address: safe };
  }
}

export type PendingView = {
  safe_tx_hash: string;
  submission_id: string | null;
  nonce: number | null;
  to: string | null;
  amount_usdc: string | null;
  proposed_at: string | null;
  confirmations: number;
  required: number | null;
  /** where the confirmation count came from */
  source: "tx_service" | "db";
  age_days: number | null;
};

export async function listPendingProposals(db: DbOrTx, deps: TreasuryDeps, entityId: string): Promise<PendingView[]> {
  const rows = await db
    .select()
    .from(schema.safeProposals)
    .where(and(eq(schema.safeProposals.entityId, entityId), eq(schema.safeProposals.status, "pending")))
    .orderBy(schema.safeProposals.nonce);
  const now = deps.now().getTime();
  const out: PendingView[] = [];
  for (const r of rows) {
    let confirmations = r.confirmations;
    let required: number | null = null;
    let source: PendingView["source"] = "db";
    try {
      const c = await getConfirmations({ apiKit: deps.apiKit(), safeTxHash: r.safeTxHash as Hex });
      confirmations = c.count;
      required = c.required;
      source = "tx_service";
    } catch {
      /* Tx Service down: report what we last saw */
    }
    out.push({
      safe_tx_hash: r.safeTxHash,
      submission_id: r.submissionId,
      nonce: r.nonce,
      to: r.toAddress,
      amount_usdc: r.amountUsdc,
      proposed_at: r.proposedAt?.toISOString() ?? null,
      confirmations,
      required,
      source,
      age_days: r.proposedAt ? Math.floor((now - r.proposedAt.getTime()) / 86_400_000) : null,
    });
  }
  return out;
}
