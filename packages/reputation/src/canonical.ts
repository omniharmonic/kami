/**
 * Canonical JSON — the one serialization used by BOTH the nightly writer and
 * the recompute CLI, so "byte-for-byte reproduction" (02 §8.3, T2.13) is a
 * meaningful claim.
 *
 * Rules (stable across engines, no external dependency):
 *  - object keys are sorted by UTF-16 code unit order (plain `<` on strings);
 *  - no whitespace anywhere;
 *  - `undefined` object members are dropped; `undefined` inside arrays becomes
 *    `null` (mirrors JSON.stringify);
 *  - numbers must be finite (NaN / ±Infinity throw); `-0` is written as `0`;
 *    number → text uses the ECMAScript Number::toString shortest round-trip
 *    algorithm, which the spec fixes exactly;
 *  - strings use JSON.stringify's escaping;
 *  - bigint, symbol and function values throw — the reputation file never
 *    contains them, and silently coercing would hide a producer bug.
 *
 * `bountyHashOf` (schemas.ts) hashes the output of this function, so the bounty
 * spec hash is stable under key reordering and pretty-printing.
 */
export function canonicalJson(value: unknown): string {
  const out: string[] = [];
  write(value, out, "$");
  return out.join("");
}

function write(value: unknown, out: string[], path: string): void {
  if (value === null) {
    out.push("null");
    return;
  }
  switch (typeof value) {
    case "boolean":
      out.push(value ? "true" : "false");
      return;
    case "number":
      if (!Number.isFinite(value)) {
        throw new TypeError(`canonicalJson: non-finite number at ${path}`);
      }
      out.push(Object.is(value, -0) ? "0" : String(value));
      return;
    case "string":
      out.push(JSON.stringify(value));
      return;
    case "undefined":
      // Only reachable inside arrays (object members are filtered by the caller).
      out.push("null");
      return;
    case "bigint":
    case "symbol":
    case "function":
      throw new TypeError(`canonicalJson: unsupported ${typeof value} at ${path}`);
    case "object":
      break;
  }
  if (Array.isArray(value)) {
    out.push("[");
    value.forEach((item, i) => {
      if (i > 0) out.push(",");
      write(item, out, `${path}[${i}]`);
    });
    out.push("]");
    return;
  }
  if (value instanceof Date) {
    out.push(JSON.stringify(value.toISOString()));
    return;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  out.push("{");
  keys.forEach((k, i) => {
    if (i > 0) out.push(",");
    out.push(JSON.stringify(k), ":");
    write(obj[k], out, `${path}.${k}`);
  });
  out.push("}");
}

/** UTF-8 bytes of the canonical serialization — what gets hashed or written to disk. */
export function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalJson(value));
}
