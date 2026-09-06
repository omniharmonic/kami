/**
 * `bindingSha256` — the hash the published `binding.json` carries and the
 * `EntityRegistered` attestation's `twinEntityURI` resolves to (architecture
 * §3, Versioning). Computed over canonical JSON: keys sorted recursively,
 * no whitespace, `undefined` dropped — so YAML vs JSON, key order and
 * formatting cannot change the hash. Array order is preserved: it is data.
 */

import { createHash } from "node:crypto";

export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = canonicalize(v);
    }
    return out;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/** Hex sha256 of the canonical JSON. */
export function bindingSha256(binding: unknown): string {
  return createHash("sha256").update(canonicalJson(binding), "utf8").digest("hex");
}
