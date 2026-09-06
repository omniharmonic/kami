/**
 * Publishing the platform's static artifacts: `entity/<slug>/status.json`
 * (hourly, `latest` class) and `entity/<slug>/binding.json` (`id` class).
 *
 * `getPublisher()` picks R2 when the bucket credentials are set, else the
 * local data dir (`KAMI_DATA_DIR`, dev default `src/fixtures/status`) — the
 * same dir `loadStatus` reads, so a local needs run is immediately visible on
 * the page.
 */
import { env } from "@/env";
import { defaultDataDir, statusFileSchema } from "@/lib/status";
import { LocalDirPublisher } from "./local";
import { CACHE_CONTROL, type Publisher } from "./publisher";
import { R2Publisher, r2EnvFrom } from "./r2";

export * from "./publisher";
export { LocalDirPublisher, HEADERS_SUFFIX } from "./local";
export { R2Publisher, r2EnvFrom, r2EnvSchema } from "./r2";

let cached: Publisher | null = null;

export function getPublisher(): Publisher {
  if (cached) return cached;
  const r2 = r2EnvFrom();
  if (r2) return (cached = new R2Publisher(r2));
  const dir = env.KAMI_DATA_DIR ?? defaultDataDir();
  return (cached = new LocalDirPublisher(dir));
}

/** Test seam. */
export function setPublisherForTests(p: Publisher | null): void {
  cached = p;
}

export function statusKey(slug: string): string {
  return `entity/${slug}/status.json`;
}

export function bindingKey(slug: string): string {
  return `entity/${slug}/binding.json`;
}

/**
 * Validate against `statusFileSchema` and publish with the twin's `latest`
 * class verbatim (ADR-E14). Throws on a shape violation: a bad build must
 * never replace a good file.
 */
export async function publishStatus(slug: string, statusFile: unknown, publisher: Publisher = getPublisher()): Promise<{ key: string; etag: string; bytes: number }> {
  const parsed = statusFileSchema.safeParse(statusFile);
  if (!parsed.success) {
    throw new Error(`status.json for ${slug} violates statusFileSchema: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  // Publish the caller's object (it may carry documented extras such as `event_chain_head`), not zod's stripped copy.
  const body = JSON.stringify(statusFile, null, 2) + "\n";
  const key = statusKey(slug);
  const { etag } = await publisher.put(key, body, { contentType: "application/json", cacheControl: CACHE_CONTROL.latest });
  return { key, etag, bytes: Buffer.byteLength(body, "utf8") };
}

/** The current binding, published beside the status with the `id` class (architecture §3). */
export async function publishBinding(slug: string, binding: unknown, sha256: string, publisher: Publisher = getPublisher()): Promise<{ key: string; etag: string }> {
  const body = JSON.stringify({ ...(binding as Record<string, unknown>), sha256 }, null, 2) + "\n";
  const key = bindingKey(slug);
  const { etag } = await publisher.put(key, body, { contentType: "application/json", cacheControl: CACHE_CONTROL.id });
  return { key, etag };
}
