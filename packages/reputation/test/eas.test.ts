import { describe, expect, it } from "vitest";
import { type EasAttestationRow, joinOutcomeRows, loadAttestationsFromEas } from "../src/eas.js";
import { EAS_SCHEMA_UIDS, entityIdOf } from "../src/schemas.js";
import { computeReputation } from "../src/v1.js";
import { uid } from "./fixtures.js";

const field = (name: string, type: string, value: unknown) => ({ name, type, signature: `${type} ${name}`, value: { name, type, value } });
const bn = (n: number | bigint) => ({ type: "BigNumber", hex: `0x${BigInt(n).toString(16)}` });

const posted = (id: string, tier: number, capUsdc: number): EasAttestationRow => ({
  id,
  schemaId: EAS_SCHEMA_UIDS.BountyPosted,
  attester: "0xPlatform",
  recipient: "0x0000000000000000000000000000000000000000",
  refUID: `0x${"0".repeat(64)}`,
  revoked: false,
  time: 1_756_000_000,
  decodedDataJson: JSON.stringify([
    field("entityId", "bytes32", entityIdOf("entity/boulder-creek")),
    field("bountyHash", "bytes32", uid(0xb0)),
    field("specURI", "string", "r2://spec"),
    field("verificationTier", "uint8", tier),
    field("capUSDC", "uint256", bn(capUsdc)),
  ]),
});
const outcome = (id: string, ref: string, out: number, time: number, recipient = "0xABCDEF0000000000000000000000000000000001", revoked = false): EasAttestationRow => ({
  id,
  schemaId: EAS_SCHEMA_UIDS.ProposalOutcome.toUpperCase().replace("0X", "0x"),
  attester: "0xEvaluator",
  recipient,
  refUID: ref,
  revoked,
  time: String(time),
  decodedDataJson: JSON.stringify([
    field("entityId", "bytes32", entityIdOf("entity/boulder-creek")),
    field("proposalHash", "bytes32", uid(0xb0)),
    field("outcome", "uint8", out),
    field("evaluatorHatId", "uint256", bn(42n)),
    field("evidenceURI", "string", "r2://evidence"),
    field("twinSnapshotHash", "bytes32", uid(0x77)),
  ]),
});

describe("EAS adapter (offline, fake indexer)", () => {
  it("joins ProposalOutcome with its BountyPosted and maps the entity hash back to a slug", () => {
    const rows = [posted(uid(1), 2, 40_000_000), outcome(uid(2), uid(1), 0, 1_757_000_000)];
    const [a] = joinOutcomeRows(rows, { knownEntities: ["entity/boulder-creek"] });
    expect(a).toEqual({
      uid: uid(2),
      entity_id: "entity/boulder-creek",
      proposal_hash: uid(0xb0),
      subject: "0xabcdef0000000000000000000000000000000001",
      outcome: 0,
      verification_tier: 2,
      usd_at_stake: 40,
      attested_at: new Date(1_757_000_000 * 1000).toISOString(),
      revoked: false,
    });
    // Unknown entity: the bytes32 hash is kept.
    expect(joinOutcomeRows(rows)[0]!.entity_id).toBe(entityIdOf("entity/boulder-creek"));
  });

  it("marks later tier-4 outcomes on the same bounty as follow-ups of the first", () => {
    const rows = [
      posted(uid(1), 4, 200_000_000),
      outcome(uid(3), uid(1), 0, 1_757_100_000),
      outcome(uid(2), uid(1), 0, 1_757_000_000),
    ];
    const joined = joinOutcomeRows(rows, { knownEntities: ["entity/boulder-creek"] });
    expect(joined.map((a) => [a.uid, a.follow_up_of])).toEqual([[uid(2), undefined], [uid(3), uid(2)]]);
    const { scores } = computeReputation(joined, { now: "2026-09-06T00:00:00Z" });
    expect(scores.find((s) => s.entity === null)!.label).toBeNull();
  });

  it("fails loudly when the referenced BountyPosted is missing", () => {
    expect(() => joinOutcomeRows([outcome(uid(2), uid(1), 0, 1)])).toThrow(/no BountyPosted/);
  });

  it("loadAttestationsFromEas fetches outcomes, then the missing refUIDs, in one join", async () => {
    const calls: string[][] = [];
    const store = new Map<string, EasAttestationRow>([
      [uid(1), posted(uid(1), 1, 25_000_000)],
      [uid(2), outcome(uid(2), uid(1), 1, 1_757_000_000)],
    ]);
    const fetchImpl = async (_url: string, init: RequestInit) => {
      const { variables } = JSON.parse(String(init.body)) as { variables: { ids: string[] } };
      calls.push(variables.ids);
      const attestations = variables.ids.map((id) => store.get(id)).filter(Boolean);
      return new Response(JSON.stringify({ data: { attestations } }), { status: 200 });
    };
    const out = await loadAttestationsFromEas([uid(2)], "http://fake/graphql", { fetchImpl, knownEntities: ["entity/boulder-creek"] });
    expect(calls).toEqual([[uid(2)], [uid(1)]]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ uid: uid(2), verification_tier: 1, usd_at_stake: 25, outcome: 1 });
  });

  it("surfaces HTTP and GraphQL errors", async () => {
    await expect(
      loadAttestationsFromEas([uid(2)], "http://fake/graphql", { fetchImpl: async () => new Response("x", { status: 502 }) }),
    ).rejects.toThrow(/HTTP 502/);
    await expect(
      loadAttestationsFromEas([uid(2)], "http://fake/graphql", {
        fetchImpl: async () => new Response(JSON.stringify({ errors: [{ message: "boom" }] }), { status: 200 }),
      }),
    ).rejects.toThrow(/boom/);
  });
});
