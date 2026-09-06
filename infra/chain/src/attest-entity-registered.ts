/**
 * `EntityRegistered(entityId, twinEntityURI, safe, guardiansHatId)` — onchain,
 * revocable, by the platform attester key, once per entity (architecture §8.2).
 * Stores `eas.attestation.EntityRegistered.<slug>`; a stored UID short-circuits.
 */
import type { EAS } from "@ethereum-attestation-service/eas-sdk";
import type { Address, Hex } from "viem";
import { type ConfigStore, writeIfChanged } from "./config.js";
import { attestOnchain } from "./eas.js";
import { type SchemaItem, entityIdOf } from "./schemas.js";

export function entityRegisteredData({ entitySlug, twinEntityURI, safe, guardiansHatId }: { entitySlug: string; twinEntityURI: string; safe: Address; guardiansHatId: bigint }): SchemaItem[] {
  return [
    { name: "entityId", type: "bytes32", value: entityIdOf(entitySlug) },
    { name: "twinEntityURI", type: "string", value: twinEntityURI },
    { name: "safe", type: "address", value: safe },
    { name: "guardiansHatId", type: "uint256", value: guardiansHatId },
  ];
}

export async function attestEntityRegistered({
  eas,
  entitySlug,
  twinEntityURI,
  safe,
  guardiansHatId,
  store,
  dryRun = false,
  log = () => {},
}: {
  eas: Pick<EAS, "attest">;
  entitySlug: string;
  twinEntityURI: string;
  safe: Address;
  guardiansHatId: bigint;
  store: ConfigStore;
  dryRun?: boolean;
  log?: (line: string) => void;
}): Promise<{ uid: Hex | null; action: "exists" | "attested" | "would-attest" }> {
  const key = `eas.attestation.EntityRegistered.${entitySlug}`;
  const stored = await store.get(key);
  if (typeof stored === "string" && /^0x[0-9a-fA-F]{64}$/.test(stored)) {
    log(`${key}: exists ${stored}`);
    return { uid: stored as Hex, action: "exists" };
  }
  const { uid } = await attestOnchain({ eas, schemaName: "EntityRegistered", data: entityRegisteredData({ entitySlug, twinEntityURI, safe, guardiansHatId }), dryRun, log });
  if (dryRun || !uid) return { uid: null, action: "would-attest" };
  await writeIfChanged(store, key, uid);
  return { uid, action: "attested" };
}
