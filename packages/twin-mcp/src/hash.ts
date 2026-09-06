/** sha256 over canonical JSON (sorted keys), via WebCrypto so it runs in Node and Workers. */

export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const keys = Object.keys(value as object).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Strips `generated_at` and `staleness_s` at every depth before hashing. */
export function stripVolatile(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stripVolatile);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === "generated_at" || k === "staleness_s") continue;
    out[k] = stripVolatile(v);
  }
  return out;
}

export async function snapshotHash(value: unknown): Promise<string> {
  return sha256Hex(canonical(stripVolatile(value)));
}
