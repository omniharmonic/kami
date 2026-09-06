import { concat, keccak256 } from "viem";
import { describe, expect, it } from "vitest";
import { merkleRootOfUids } from "../src/v1.js";
import { uid } from "./fixtures.js";

describe("merkleRootOfUids", () => {
  const a = uid(0x11), b = uid(0x22), c = uid(0x33), d = uid(0x44), e = uid(0x55);

  it("empty → zero bytes32; single → the uid itself", () => {
    expect(merkleRootOfUids([])).toBe(`0x${"0".repeat(64)}`);
    expect(merkleRootOfUids([b])).toBe(b);
  });
  it("two leaves → keccak256(sorted left ‖ right), no leaf hashing", () => {
    expect(merkleRootOfUids([b, a])).toBe(keccak256(concat([a, b])));
  });
  it("odd level duplicates the last node", () => {
    const ab = keccak256(concat([a, b]));
    const cc = keccak256(concat([c, c]));
    expect(merkleRootOfUids([a, b, c])).toBe(keccak256(concat([ab, cc])));
    // five leaves: ((ab)(cd))((ee)(ee))
    const cd = keccak256(concat([c, d]));
    const ee = keccak256(concat([e, e]));
    const abcd = keccak256(concat([ab, cd]));
    const eeee = keccak256(concat([ee, ee]));
    expect(merkleRootOfUids([a, b, c, d, e])).toBe(keccak256(concat([abcd, eeee])));
  });
  it("is independent of input order, case and duplicates", () => {
    const r = merkleRootOfUids([a, b, c, d, e]);
    expect(merkleRootOfUids([e, c, a, d, b])).toBe(r);
    expect(merkleRootOfUids([e, c, a, d, b, a, e])).toBe(r);
    expect(merkleRootOfUids([e.toUpperCase().replace("0X", "0x"), c, a, d, b])).toBe(r);
  });
  it("is deterministic and sensitive to membership", () => {
    expect(merkleRootOfUids([a, b, c])).toBe(merkleRootOfUids([a, b, c]));
    expect(merkleRootOfUids([a, b, c])).not.toBe(merkleRootOfUids([a, b, d]));
  });
  it("rejects non-bytes32 input", () => {
    expect(() => merkleRootOfUids(["0x1234"])).toThrow(/bytes32/);
  });
});
