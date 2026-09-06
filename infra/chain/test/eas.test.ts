import { OFFCHAIN_ATTESTATION_TYPES, OffchainAttestationVersion } from "../src/eas-sdk.js";
import { type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { entityRegisteredData } from "../src/attest-entity-registered.js";
import { OFFCHAIN_ATTEST_TYPES, attestOnchain, buildOffchainAttestation, merkleRootOfUids, timestampUids, verifyOffchain } from "../src/eas.js";
import { EAS_SCHEMA_UIDS, bountyHashOf, encodeSchemaData, entityIdOf } from "../src/schemas.js";
import { MemoryConfigStore } from "../src/config.js";
import { attestEntityRegistered } from "../src/attest-entity-registered.js";

const evaluator = privateKeyToAccount("0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba");
const eas = "0x4200000000000000000000000000000000000021" as Address;
const salt = ("0x" + "ab".repeat(32)) as Hex;

function outcomePayload(outcome = 0) {
  return buildOffchainAttestation({
    chainId: 84532, easAddress: eas, easVersion: "1.2.0", schemaName: "ProposalOutcome", time: 1_757_000_000n, salt,
    data: [
      { name: "entityId", type: "bytes32", value: entityIdOf("boulder-creek") },
      { name: "proposalHash", type: "bytes32", value: bountyHashOf({ title: "count riffles" }) },
      { name: "outcome", type: "uint8", value: outcome },
      { name: "evaluatorHatId", type: "uint256", value: 42n },
      { name: "evidenceURI", type: "string", value: "r2://evidence/1" },
      { name: "twinSnapshotHash", type: "bytes32", value: "0x" + "00".repeat(32) },
    ],
  });
}

describe("offchain attestations", () => {
  it("uses exactly the EAS SDK's v2 Attest typed-data fields", () => {
    const sdk = OFFCHAIN_ATTESTATION_TYPES[OffchainAttestationVersion.Version2]![0]!;
    expect(OFFCHAIN_ATTEST_TYPES.Attest).toEqual(sdk.types.Attest);
    expect(sdk.domain).toBe("EAS Attestation");
  });
  it("round-trips: evaluator signs the payload client-side, verifyOffchain accepts, a tampered outcome is rejected", async () => {
    const payload = outcomePayload(0);
    expect(payload.message.schema).toBe(EAS_SCHEMA_UIDS.ProposalOutcome);
    const signature = await evaluator.signTypedData({ domain: payload.domain, types: payload.types, primaryType: payload.primaryType, message: payload.message });
    expect(await verifyOffchain({ payload, signature, attester: evaluator.address })).toEqual({ ok: true });
    const other = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
    expect((await verifyOffchain({ payload, signature, attester: other.address })).ok).toBe(false);
    const tampered = { ...payload, message: { ...payload.message, data: outcomePayload(2).message.data } };
    expect((await verifyOffchain({ payload: tampered, signature, attester: evaluator.address })).reason).toMatch(/uid/);
  });
  it("uid changes with the data and the salt", () => {
    expect(outcomePayload(0).uid).not.toBe(outcomePayload(1).uid);
    expect(outcomePayload(0).uid).toBe(outcomePayload(0).uid);
  });
  it("encodeSchemaData enforces field order", () => {
    expect(() => encodeSchemaData("ReputationSnapshot", [{ name: "rootOfUIDs", type: "bytes32", value: salt }])).toThrow(/fields must be exactly/);
  });
});

describe("timestampUids", () => {
  it("calls multiTimestamp once with sorted unique uids and returns the merkle root", async () => {
    const calls: string[][] = [];
    const fakeEas = { multiTimestamp: async (d: string[]) => { calls.push(d); return { wait: async () => d.map(() => 1n) } as never; } };
    const a = ("0x" + "02".repeat(32)) as Hex;
    const b = ("0x" + "01".repeat(32)) as Hex;
    const r = await timestampUids({ eas: fakeEas as never, uids: [a, b, a] });
    expect(calls).toEqual([[b, a]]);
    expect(r.merkleRoot).toBe(merkleRootOfUids([a, b]));
    expect(r.timestamps).toEqual([1n, 1n]);
  });
  it("dry-run sends nothing", async () => {
    let n = 0;
    const fakeEas = { multiTimestamp: async () => { n += 1; return { wait: async () => [] } as never; } };
    await timestampUids({ eas: fakeEas as never, uids: ["0x" + "01".repeat(32)], dryRun: true });
    expect(n).toBe(0);
  });
});

describe("EntityRegistered", () => {
  const safe = "0x2000000000000000000000000000000000000002" as Address;
  it("attests once with the schema's fields and stores the UID; re-run is a no-op", async () => {
    const requests: unknown[] = [];
    const fakeEas = { attest: async (r: unknown) => { requests.push(r); return { wait: async () => "0x" + "cd".repeat(32) } as never; } };
    const store = new MemoryConfigStore();
    const args = { eas: fakeEas as never, entitySlug: "boulder-creek", twinEntityURI: "twin://places/x", safe, guardiansHatId: 7n, store };
    const r1 = await attestEntityRegistered(args);
    expect(r1.action).toBe("attested");
    expect(requests).toHaveLength(1);
    expect((requests[0] as { schema: string }).schema).toBe(EAS_SCHEMA_UIDS.EntityRegistered);
    expect((requests[0] as { data: { revocable: boolean } }).data.revocable).toBe(true);
    const r2 = await attestEntityRegistered(args);
    expect(r2.action).toBe("exists");
    expect(requests).toHaveLength(1);
  });
  it("encodes entityId = keccak256(slug)", async () => {
    const data = entityRegisteredData({ entitySlug: "boulder-creek", twinEntityURI: "u", safe, guardiansHatId: 1n });
    expect(data[0]!.value).toBe(entityIdOf("boulder-creek"));
    const r = await attestOnchain({ eas: { attest: async () => { throw new Error("must not be called"); } } as never, schemaName: "EntityRegistered", data, dryRun: true });
    expect(r.uid).toBeNull();
    expect(r.request.data).toMatch(/^0x/);
  });
});
