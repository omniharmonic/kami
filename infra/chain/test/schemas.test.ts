import { EAS_SCHEMAS as REPUTATION_SCHEMAS, schemaUidFor as reputationSchemaUidFor } from "@kami/reputation";
import { describe, expect, it } from "vitest";
import { EAS_SCHEMAS, EAS_SCHEMA_UIDS, SCHEMA_NAMES, SCHEMA_RESOLVER, SCHEMA_REVOCABLE, schemaUidFor } from "../src/schemas.js";

describe("EAS schemas", () => {
  it("are the five strings from architecture §8.1, verbatim, shared with @kami/reputation", () => {
    expect(SCHEMA_NAMES).toEqual(["EntityRegistered", "BountyPosted", "BountyCompleted", "ProposalOutcome", "ReputationSnapshot"]);
    expect(EAS_SCHEMAS).toBe(REPUTATION_SCHEMAS);
    expect(EAS_SCHEMAS.EntityRegistered).toBe("bytes32 entityId, string twinEntityURI, address safe, uint256 guardiansHatId");
    expect(EAS_SCHEMAS.BountyCompleted).toBe("bytes32 entityId, bytes32 bountyHash, address recipient, uint256 amountUSDC, bytes32 safeTxHash, string evidenceURI");
  });
  it("UID = keccak256(abi.encodePacked(schema, resolver=0x0, revocable=true)) — pinned", () => {
    expect(schemaUidFor(EAS_SCHEMAS.EntityRegistered, SCHEMA_RESOLVER, SCHEMA_REVOCABLE)).toBe("0xe561dc7831d46187cd17792bee927ff18201a17fc4831b0a9d2de7586c26776e");
    expect(EAS_SCHEMA_UIDS.EntityRegistered).toBe("0xe561dc7831d46187cd17792bee927ff18201a17fc4831b0a9d2de7586c26776e");
    expect(schemaUidFor).toBe(reputationSchemaUidFor);
  });
  it("a non-revocable registration would be a different schema", () => {
    expect(schemaUidFor(EAS_SCHEMAS.EntityRegistered, SCHEMA_RESOLVER, false)).not.toBe(EAS_SCHEMA_UIDS.EntityRegistered);
  });
});
