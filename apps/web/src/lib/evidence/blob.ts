import { createHmac, timingSafeEqual } from "node:crypto";
import { del, get, put } from "@vercel/blob";
import { MAX_FILE_BYTES, PRESIGN_TTL_S, type EvidenceStorage } from "./storage";

export type UploadGrant = { key: string; mime: string; bytes: number; exp: number };
function secret() {
  const value = process.env.BETTER_AUTH_SECRET ?? process.env.CHAT_COOKIE_SECRET;
  if (!value || value.length < 16) throw new Error("A configured signing secret is required for private evidence uploads");
  return value;
}
export function validGrant(grant: UploadGrant, now = Date.now()) {
  return /^evidence\/[a-z0-9-]+\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/.test(grant.key)
    && !grant.key.includes("..") && /^[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+$/.test(grant.mime)
    && Number.isSafeInteger(grant.bytes) && grant.bytes > 0 && grant.bytes <= MAX_FILE_BYTES
    && Number.isSafeInteger(grant.exp) && grant.exp * 1000 >= now && grant.exp * 1000 <= now + (PRESIGN_TTL_S + 5) * 1000;
}
export function signBlobGrant(grant: UploadGrant) {
  return createHmac("sha256", secret()).update(JSON.stringify([grant.key, grant.mime, grant.bytes, grant.exp])).digest("base64url");
}
export function verifyBlobGrant(grant: UploadGrant, signature: string | null, now = Date.now()) {
  if (!signature || !validGrant(grant, now)) return false;
  const a = Buffer.from(signature), b = Buffer.from(signBlobGrant(grant));
  return a.length === b.length && timingSafeEqual(a, b);
}
export async function boundedBytes(stream: ReadableStream<Uint8Array> | null, limit: number): Promise<Buffer> {
  if (!stream) return Buffer.alloc(0);
  const reader = stream.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error("file_too_large"); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, size);
}
export async function writeBlobEvidence(grant: UploadGrant, bytes: Buffer) {
  if (!validGrant(grant) || bytes.byteLength !== grant.bytes) throw new Error("invalid_upload");
  // A grant cannot replace already finalized evidence by replaying its URL.
  await put(grant.key, bytes, { access: "private", contentType: grant.mime, addRandomSuffix: false, allowOverwrite: false });
}
export function blobStorage(baseUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:3000"): EvidenceStorage {
  return {
    kind: "blob",
    async presignPut(key, mime, bytes) {
      const grant = { key, mime, bytes, exp: Math.floor(Date.now() / 1000) + PRESIGN_TTL_S };
      if (!validGrant(grant)) throw new Error("invalid_upload");
      const url = new URL(`/api/evidence/blob/${encodeURIComponent(key)}`, baseUrl);
      url.searchParams.set("exp", String(grant.exp)); url.searchParams.set("mime", mime); url.searchParams.set("bytes", String(bytes)); url.searchParams.set("sig", signBlobGrant(grant));
      return { url: url.toString(), method: "PUT", headers: { "content-type": mime }, expires_at: new Date(grant.exp * 1000).toISOString() };
    },
    async getObject(key) {
      if (!key.startsWith("evidence/") || key.includes("..")) throw new Error("invalid_key");
      const result = await get(key, { access: "private", useCache: false });
      if (!result || result.statusCode !== 200) return null;
      return boundedBytes(result.stream, MAX_FILE_BYTES);
    },
    async deleteObject(key) {
      if (!key.startsWith("evidence/") || key.includes("..")) throw new Error("invalid_key");
      await del(key);
    },
  };
}
