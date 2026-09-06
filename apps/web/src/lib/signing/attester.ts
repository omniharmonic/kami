/**
 * The platform attester role (architecture §8.2): onchain `BountyCompleted`
 * and `ReputationSnapshot`, and the nightly `multiTimestamp` of offchain UIDs.
 */
import type { Address, Hex } from "viem";
import { attestOnchain, timestampUids, ZERO_BYTES32, type EasSchemaName, type SchemaItem } from "@kami/chain";
import type { TreasuryDeps } from "@/lib/treasury/deps";

export async function attesterAddress(deps: TreasuryDeps): Promise<Address> {
  return (await deps.backend()).getAddress("attester");
}

export async function attest(
  deps: TreasuryDeps,
  args: { schemaName: EasSchemaName; data: SchemaItem[]; refUID?: Hex; recipient?: Address },
): Promise<{ uid: Hex; request: { schema: Hex; data: Hex; recipient: Address; refUID: Hex } }> {
  const eas = await deps.eas();
  const r = await attestOnchain({
    eas,
    schemaName: args.schemaName,
    data: args.data,
    refUID: args.refUID ?? ZERO_BYTES32,
    ...(args.recipient ? { recipient: args.recipient } : {}),
    log: deps.log,
  });
  if (!r.uid) throw new Error("attestOnchain returned no uid");
  return { uid: r.uid, request: r.request };
}

/**
 * One `EAS.multiTimestamp(uids)` for the nightly batch. The tx hash is read
 * off the SDK `Transaction`'s receipt after `wait()` (*verify* docs/verify.md #9:
 * eas-sdk 2.10 exposes `receipt` on the Transaction object).
 */
export async function timestampBatch(deps: TreasuryDeps, uids: readonly string[]): Promise<{ uids: Hex[]; merkleRoot: Hex; txHash: Hex | null; timestamps: bigint[] | null }> {
  const eas = await deps.eas();
  let captured: { receipt?: { hash?: string } | null } | null = null;
  const wrapped = {
    multiTimestamp: async (data: string[]) => {
      const tx = await eas.multiTimestamp(data);
      captured = tx as unknown as { receipt?: { hash?: string } | null };
      return tx;
    },
  } as unknown as Parameters<typeof timestampUids>[0]["eas"];
  const r = await timestampUids({ eas: wrapped, uids, log: deps.log });
  const hash = (captured as { receipt?: { hash?: string } | null } | null)?.receipt?.hash;
  return { uids: r.uids, merkleRoot: r.merkleRoot, timestamps: r.timestamps, txHash: hash && /^0x[0-9a-fA-F]{64}$/.test(hash) ? (hash as Hex) : null };
}
