import { describe, expect, it } from "vitest";
import { canonicalBytes, canonicalJson } from "../src/canonical.js";

describe("canonicalJson", () => {
  it("sorts keys recursively and emits no whitespace", () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { z: 0, y: null }], c: "x" } })).toBe(
      '{"a":{"c":"x","d":[1,{"y":null,"z":0}]},"b":1}',
    );
  });
  it("is independent of key insertion order", () => {
    const x = { b: 1, a: 2, c: { e: 1, d: 2 } };
    const y = { c: { d: 2, e: 1 }, a: 2, b: 1 };
    expect(canonicalJson(x)).toBe(canonicalJson(y));
  });
  it("drops undefined members, keeps nulls, nulls undefined in arrays", () => {
    expect(canonicalJson({ a: undefined, b: null, c: [undefined] })).toBe('{"b":null,"c":[null]}');
  });
  it("normalizes -0 and rejects non-finite numbers and bigints", () => {
    expect(canonicalJson({ z: -0 })).toBe('{"z":0}');
    expect(() => canonicalJson({ n: NaN })).toThrow(/non-finite/);
    expect(() => canonicalJson([Infinity])).toThrow(/non-finite/);
    expect(() => canonicalJson({ big: 1n })).toThrow(/bigint/);
  });
  it("escapes strings like JSON.stringify and serializes Dates as ISO", () => {
    expect(canonicalJson('he said "hi"\n')).toBe('"he said \\"hi\\"\\n"');
    expect(canonicalJson(new Date(0))).toBe('"1970-01-01T00:00:00.000Z"');
  });
  it("round-trips through JSON.parse", () => {
    const v = { scores: [{ subject: "a", n: 1.5, score: null }], inputs: ["0xab"] };
    expect(JSON.parse(canonicalJson(v))).toEqual(v);
    expect(new TextDecoder().decode(canonicalBytes(v))).toBe(canonicalJson(v));
  });
});
