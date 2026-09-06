/**
 * `R2Publisher` — S3-compatible PUT/GET via `@aws-sdk/client-s3`. Cloudflare
 * R2 honours `CacheControl` and `ContentType` on the object, which is what the
 * public bucket URL (`KAMI_DATA_BASE_URL`) then serves.
 *
 * Env (read here, not in `src/env.ts`): `R2_ACCOUNT_ID` (or `R2_ENDPOINT`),
 * `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` (default
 * `kami-data`, plan T0.6).
 */
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { z } from "zod";
import { assertKey, etagFor, type Publisher, type PublishedObject, type PutOptions } from "./publisher";

export const r2EnvSchema = z.object({
  R2_ACCOUNT_ID: z.string().min(1).optional(),
  R2_ENDPOINT: z.string().url().optional(),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET: z.string().min(1).default("kami-data"),
});

export type R2Env = z.infer<typeof r2EnvSchema>;

/** Parsed R2 settings, or null when the bucket is not configured (local mode). */
export function r2EnvFrom(source: NodeJS.ProcessEnv = process.env): R2Env | null {
  if (!source.R2_ACCESS_KEY_ID && !source.R2_SECRET_ACCESS_KEY) return null;
  const parsed = r2EnvSchema.safeParse(source);
  if (!parsed.success) throw new Error(`R2 misconfigured: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
  if (!parsed.data.R2_ACCOUNT_ID && !parsed.data.R2_ENDPOINT) throw new Error("R2 misconfigured: set R2_ACCOUNT_ID or R2_ENDPOINT");
  return parsed.data;
}

type S3Like = Pick<S3Client, "send">;

export class R2Publisher implements Publisher {
  private readonly client: S3Like;
  readonly bucket: string;

  constructor(env: R2Env, client?: S3Like) {
    this.bucket = env.R2_BUCKET;
    this.client =
      client ??
      new S3Client({
        region: "auto",
        endpoint: env.R2_ENDPOINT ?? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
        forcePathStyle: true,
      });
  }

  async put(key: string, body: string, opts: PutOptions): Promise<{ etag: string }> {
    const Key = assertKey(key);
    const out = (await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key, Body: body, ContentType: opts.contentType, CacheControl: opts.cacheControl }),
    )) as { ETag?: string };
    return { etag: out.ETag ?? etagFor(body) };
  }

  async get(key: string): Promise<PublishedObject | null> {
    const Key = assertKey(key);
    try {
      const out = (await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key }))) as {
        Body?: { transformToString(): Promise<string> };
        ContentType?: string;
        CacheControl?: string;
        ETag?: string;
      };
      const body = out.Body ? await out.Body.transformToString() : "";
      return { body, contentType: out.ContentType ?? null, cacheControl: out.CacheControl ?? null, etag: out.ETag ?? null };
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (name === "NoSuchKey" || name === "NotFound") return null;
      throw err;
    }
  }
}
