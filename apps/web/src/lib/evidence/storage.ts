/**
 * Evidence object storage: R2 through the S3 API (presigned PUT, arch §6.2)
 * or, in development with `KAMI_DATA_DIR` and no R2 keys, a local directory
 * served by `/api/evidence/local/[key]`. Keys are `evidence/<slug>/<claim>/<file>`.
 * The chat/auth secret signs local URLs so a dev PUT still needs a session.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_FILES_PER_SUBMISSION = 30;
export const PRESIGN_TTL_S = 15 * 60;

export type PresignedPut = { url: string; method: "PUT"; headers: Record<string, string>; expires_at: string };

export interface EvidenceStorage {
  kind: "r2" | "local" | "blob";
  presignPut(key: string, mime: string, bytes: number): Promise<PresignedPut>;
  getObject(key: string): Promise<Buffer | null>;
  deleteObject(key: string): Promise<void>;
}

function r2Env() {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_ENDPOINT } = process.env;
  if (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) return null;
  const endpoint = R2_ENDPOINT ?? (R2_ACCOUNT_ID ? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : null);
  if (!endpoint) return null;
  return { endpoint, accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY, bucket: R2_BUCKET };
}

async function r2Storage(cfg: NonNullable<ReturnType<typeof r2Env>>): Promise<EvidenceStorage> {
  const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = await import("@aws-sdk/client-s3");
  const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
  const client = new S3Client({ region: "auto", endpoint: cfg.endpoint, credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey } });
  return {
    kind: "r2",
    async presignPut(key, mime, bytes) {
      const url = await getSignedUrl(client, new PutObjectCommand({ Bucket: cfg.bucket, Key: key, ContentType: mime, ContentLength: bytes }), { expiresIn: PRESIGN_TTL_S });
      return { url, method: "PUT", headers: { "content-type": mime }, expires_at: new Date(Date.now() + PRESIGN_TTL_S * 1000).toISOString() };
    },
    async getObject(key) {
      try {
        const res = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
        const bytes = await res.Body?.transformToByteArray();
        return bytes ? Buffer.from(bytes) : null;
      } catch {
        return null;
      }
    },
    async deleteObject(key) {
      await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
    },
  };
}

function localSecret(): string {
  return process.env.CHAT_COOKIE_SECRET ?? process.env.BETTER_AUTH_SECRET ?? "kami-dev-evidence-secret";
}

export function signLocalKey(key: string, exp: number): string {
  return createHmac("sha256", localSecret()).update(`${key}.${exp}`).digest("base64url");
}

export function verifyLocalSig(key: string, exp: number, sig: string | null, now = Date.now()): boolean {
  if (!sig || !Number.isFinite(exp) || exp * 1000 < now) return false;
  const a = Buffer.from(sig);
  const b = Buffer.from(signLocalKey(key, exp));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function localEvidenceDir(): string {
  return path.join(process.env.KAMI_DATA_DIR ?? path.join(process.cwd(), "src", "fixtures", "status"), "evidence");
}

export function localPathFor(key: string): string {
  const safe = key.split("/").filter((p) => p && p !== "." && p !== "..");
  return path.join(localEvidenceDir(), ...safe);
}

export function localStorage(baseUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:3000"): EvidenceStorage {
  return {
    kind: "local",
    async presignPut(key, mime) {
      const exp = Math.floor(Date.now() / 1000) + PRESIGN_TTL_S;
      const sig = signLocalKey(key, exp);
      const url = `${baseUrl.replace(/\/$/, "")}/api/evidence/local/${encodeURIComponent(key)}?exp=${exp}&sig=${sig}`;
      return { url, method: "PUT", headers: { "content-type": mime }, expires_at: new Date(exp * 1000).toISOString() };
    },
    async getObject(key) {
      try {
        return await fs.readFile(localPathFor(key));
      } catch {
        return null;
      }
    },
    async deleteObject(key) {
      await fs.rm(localPathFor(key), { force: true });
    },
  };
}

let cached: Promise<EvidenceStorage> | null = null;

export function getEvidenceStorage(): Promise<EvidenceStorage> {
  if (!cached) {
    const cfg = r2Env();
    if (cfg) cached = r2Storage(cfg);
    else if (process.env.BLOB_READ_WRITE_TOKEN) cached = import("./blob").then(({ blobStorage }) => blobStorage());
    else if (process.env.NODE_ENV === "production") throw new Error("No persistent evidence storage configured");
    else cached = Promise.resolve(localStorage());
  }
  return cached;
}

/** Test seam. */
export function setEvidenceStorageForTests(s: EvidenceStorage | null): void {
  cached = s ? Promise.resolve(s) : null;
}

export function evidenceKey(slug: string, claimId: string, fileId: string, mime: string): string {
  const ext = mime === "image/jpeg" ? "jpg" : mime === "image/png" ? "png" : mime === "image/heic" ? "heic" : mime === "image/webp" ? "webp" : "bin";
  return `evidence/${slug}/${claimId}/${fileId}.${ext}`;
}
