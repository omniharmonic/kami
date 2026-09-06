/**
 * `LocalDirPublisher` — writes `<dir>/<key>` plus the twin's sidecar
 * `<key>.headers.json` (`Cache-Control`, `Content-Type`, `ETag`), so a local
 * tree written here is byte-compatible with the fixture trees the twin ships
 * (survey §1.3, `backends.py:100, 310-315`). Writes are atomic (temp + rename).
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { assertKey, etagFor, type Publisher, type PublishedObject, type PutOptions } from "./publisher";

export const HEADERS_SUFFIX = ".headers.json";

export class LocalDirPublisher implements Publisher {
  constructor(readonly dir: string) {}

  fileFor(key: string): string {
    return path.join(this.dir, ...assertKey(key).split("/"));
  }

  async put(key: string, body: string, opts: PutOptions): Promise<{ etag: string }> {
    const file = this.fileFor(key);
    const etag = etagFor(body);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, body, "utf8");
    await fs.rename(tmp, file);
    const headers = { "Cache-Control": opts.cacheControl, "Content-Type": opts.contentType, ETag: etag };
    await fs.writeFile(`${file}${HEADERS_SUFFIX}`, JSON.stringify(headers, null, 2) + "\n", "utf8");
    return { etag };
  }

  async get(key: string): Promise<PublishedObject | null> {
    const file = this.fileFor(key);
    let body: string;
    try {
      body = await fs.readFile(file, "utf8");
    } catch {
      return null;
    }
    let headers: Record<string, string> = {};
    try {
      headers = JSON.parse(await fs.readFile(`${file}${HEADERS_SUFFIX}`, "utf8")) as Record<string, string>;
    } catch {
      /* no sidecar: a hand-written fixture */
    }
    return {
      body,
      contentType: headers["Content-Type"] ?? null,
      cacheControl: headers["Cache-Control"] ?? null,
      etag: headers["ETag"] ?? etagFor(body),
    };
  }
}
