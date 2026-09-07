import { get, put } from "@vercel/blob";
import { assertKey, etagFor, type Publisher, type PublishedObject, type PutOptions } from "./publisher";

/** Objects remain private; consumers must apply their own entity visibility gate. */
export class BlobPublisher implements Publisher {
  async put(key: string, body: string, opts: PutOptions): Promise<{ etag: string }> {
    const etag = etagFor(body);
    const envelope: PublishedObject = { body, etag, contentType: opts.contentType, cacheControl: opts.cacheControl };
    await put(`publications/${assertKey(key)}`, JSON.stringify(envelope), { access: "private", contentType: "application/json", addRandomSuffix: false, allowOverwrite: true });
    return { etag };
  }
  async get(key: string): Promise<PublishedObject | null> {
    const result = await get(`publications/${assertKey(key)}`, { access: "private", useCache: false });
    if (!result || result.statusCode !== 200) return null;
    const value: unknown = await new Response(result.stream).json();
    if (!value || typeof value !== "object") return null;
    const row = value as PublishedObject;
    if (typeof row.body !== "string" || row.etag !== etagFor(row.body) || typeof row.contentType !== "string" || typeof row.cacheControl !== "string") return null;
    return row;
  }
}
