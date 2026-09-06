import { keccak256, stringToBytes, zeroAddress } from "viem";
import { describe, expect, it } from "vitest";
import {
  EAS_SCHEMAS,
  EAS_SCHEMA_UIDS,
  OUTCOME_NAMES,
  Outcome,
  bountyHashOf,
  entityIdOf,
  schemaUidFor,
} from "../src/schemas.js";

describe("EAS schema strings (02 §8.1, verbatim)", () => {
  it("are the five strings from the architecture doc", () => {
    expect(EAS_SCHEMAS.EntityRegistered).toBe(
      "bytes32 entityId, string twinEntityURI, address safe, uint256 guardiansHatId",
    );
    expect(EAS_SCHEMAS.BountyPosted).toBe(
      "bytes32 entityId, bytes32 bountyHash, string specURI, uint8 verificationTier, uint256 capUSDC",
    );
    expect(EAS_SCHEMAS.BountyCompleted).toBe(
      "bytes32 entityId, bytes32 bountyHash, address recipient, uint256 amountUSDC, bytes32 safeTxHash, string evidenceURI",
    );
    expect(EAS_SCHEMAS.ProposalOutcome).toBe(
      "bytes32 entityId, bytes32 proposalHash, uint8 outcome, uint256 evaluatorHatId, string evidenceURI, bytes32 twinSnapshotHash",
    );
    expect(EAS_SCHEMAS.ReputationSnapshot).toBe(
      "bytes32 entityId, bytes32 rootOfUIDs, string scoresURI, uint64 computedAt",
    );
  });
  it("outcome enum is {0 succeeded, 1 partial, 2 failed, 3 unverifiable}", () => {
    expect(Outcome).toEqual({ succeeded: 0, partial: 1, failed: 2, unverifiable: 3 });
    expect(OUTCOME_NAMES[3]).toBe("unverifiable");
  });
});

describe("entityIdOf", () => {
  it("is keccak256 of the utf-8 slug, with or without the entity/ prefix", () => {
    const expected = keccak256(stringToBytes("boulder-creek"));
    expect(entityIdOf("boulder-creek")).toBe(expected);
    expect(entityIdOf("entity/boulder-creek")).toBe(expected);
    expect(() => entityIdOf("entity/")).toThrow();
  });
});

describe("bountyHashOf", () => {
  it("is stable under key reordering and whitespace", () => {
    const a = { title: "Clear the culvert", cap_usd: 40, tier: 2, prediction: { direction: "down", place: "x" } };
    const b = { prediction: { place: "x", direction: "down" }, tier: 2, cap_usd: 40, title: "Clear the culvert" };
    expect(bountyHashOf(a)).toBe(bountyHashOf(b));
    expect(bountyHashOf(a)).toBe(bountyHashOf(JSON.parse(JSON.stringify(b, null, 2))));
    expect(bountyHashOf(a)).toMatch(/^0x[0-9a-f]{64}$/);
  });
  it("changes when any value changes", () => {
    expect(bountyHashOf({ cap_usd: 40 })).not.toBe(bountyHashOf({ cap_usd: 41 }));
  });
});

describe("schemaUidFor", () => {
  it("derives the UID the way EAS SchemaRegistry does: keccak256(abi.encodePacked(schema, resolver, revocable))", () => {
    // External cross-check: `bool like` with the zero resolver, revocable, is the
    // schema EAS uses as its canonical example; its UID is published on the
    // EAS explorers as 0x33e9…91fd.
    expect(schemaUidFor("bool like")).toBe(
      "0x33e9094830a5cba5554d1954310e4fbed2ef5f859ec1404619adea4207f391fd",
    );
    expect(schemaUidFor("bool like", zeroAddress, true)).toBe(schemaUidFor("bool like"));
    expect(schemaUidFor("bool like", zeroAddress, false)).not.toBe(schemaUidFor("bool like"));
    expect(schemaUidFor("bool like", "0x000000000000000000000000000000000000dEaD")).not.toBe(
      schemaUidFor("bool like"),
    );
  });

  it("REGRESSION PIN: the five Kami schema UIDs under the default parameters", () => {
    // These values were computed once with this implementation and pinned.
    // They are not an independent oracle — the test above is — but they make
    // any accidental change to a schema string, the encoding, or the default
    // (resolver = 0x0, revocable = true) fail loudly, because infra/chain/
    // registers exactly these strings and the recompute CLI filters EAS
    // results by these UIDs.
    expect(EAS_SCHEMA_UIDS).toEqual({
      EntityRegistered: "0xe561dc7831d46187cd17792bee927ff18201a17fc4831b0a9d2de7586c26776e",
      BountyPosted: "0x2549356ae0a77e7351d4e9b2de43033983241f8db6fa49e171182e8d03351187",
      BountyCompleted: "0xc5820c0400ac19c9b30aca716009fa7e708a1377fa40a063f3b7a4d062419eee",
      ProposalOutcome: "0xb5fe01ab1ab7d16c32d36b24ccaa92a1383795119c8109548aa9ee5a919a74ce",
      ReputationSnapshot: "0xee9750e0a70705b6ade627257b3b345506fbdcc2e86c48cdaaacb5218dae4c6e",
    });
  });
});
