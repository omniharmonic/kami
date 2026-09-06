/**
 * The publisher behind `status.json` (ADR-E14). Two backends share one
 * interface: a local directory (dev, tests, the twin's own fixture layout with
 * a `<file>.headers.json` sidecar) and an S3-compatible bucket (Cloudflare
 * R2 in production).
 *
 * Cache classes are the twin's own, verbatim (survey §1.3). There is no safe
 * default: an unknown class throws, exactly as `cache_control_for` does.
 */
import { createHash } from "node:crypto";

export const CACHE_CONTROL = {
  latest: "public, max-age=60, s-maxage=120, stale-while-revalidate=600, stale-if-error=86400",
  id: "public, max-age=300",
} as const;

export type CacheClass = keyof typeof CACHE_CONTROL;

export function cacheControlFor(cls: string): string {
  const v = (CACHE_CONTROL as Record<string, string>)[cls];
  if (!v) throw new Error(`unknown cache class: ${cls}`);
  return v;
}

export type PutOptions = { contentType: string; cacheControl: string };

export type PublishedObject = {
  body: string;
  contentType: string | null;
  cacheControl: string | null;
  etag: string | null;
};

export interface Publisher {
  /** Write one object at `key` (e.g. `entity/boulder-creek/status.json`). */
  put(key: string, body: string, opts: PutOptions): Promise<{ etag: string }>;
  /** Read it back; `null` when absent. */
  get(key: string): Promise<PublishedObject | null>;
}

/** The twin's ETag convention for a body: a quoted short sha256. */
export function etagFor(body: string): string {
  return `"${createHash("sha256").update(body, "utf8").digest("hex").slice(0, 32)}"`;
}

/** Keys are tree-relative POSIX paths; nothing may climb out. */
export function assertKey(key: string): string {
  const k = key.replace(/^\/+/, "");
  if (!k || k.split("/").some((seg) => seg === "" || seg === "." || seg === "..")) {
    throw new TypeError(`refusing key outside the tree: ${key}`);
  }
  return k;
}
