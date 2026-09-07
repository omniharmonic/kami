import { describe, expect, it } from "vitest";
import { eligibleOutcomeUid } from "../attest";
const uid = `0x${"1".repeat(64)}`;
describe("outcome eligibility", () => {
  it("retains chain UIDs and signed offchain outcomes without requiring onchain publication", () => {
    expect(eligibleOutcomeUid(uid, null)).toBe(uid);
    expect(eligibleOutcomeUid(null, { uid, signature: `0x${"12".repeat(65)}` })).toBe(uid);
  });
  it("rejects pending references and missing, empty or zero signatures", () => {
    expect(eligibleOutcomeUid(`pending:${"1".repeat(64)}`, null)).toBeNull();
    for (const signature of [null, undefined, "", "0x", `0x${"0".repeat(130)}`]) expect(eligibleOutcomeUid(uid, { uid, signature })).toBeNull();
  });
});
