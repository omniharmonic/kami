/**
 * `TreeReader` — the one way this package touches the twin.
 *
 * `--tree` is either an https base URL (the CDN) or a local directory (a
 * fixture tree, or a publisher's local backend). Either way the reader is a
 * browser: GET, `If-None-Match`, an in-memory cache keyed by path with the
 * tree's own cache classes as TTLs (60 s for `latest/**`, 300 s for `id/`,
 * `geom/`, `boundary/`, `network/`), a 60 s floor per path against a remote
 * tree no matter how often a caller asks, a `User-Agent` with a contact
 * address, and 404 → `null` — which is a meaningful state (superseded,
 * withdrawn, not yet published), never an error.
 */

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export const PACKAGE_VERSION = "0.1.0";
/** *verify* the contact address with the twin's operator (architecture §4.1). */
export const DEFAULT_CONTACT = "contact@bioregionaltwin.org";
export const DEFAULT_TREE = "https://data.bioregionaltwin.org";

export const TTL_LATEST_MS = 60_000;
export const TTL_STATIC_MS = 300_000;
export const TTL_NETWORK_MS = 3_600_000;
export const REMOTE_FLOOR_MS = 60_000;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface TreeReaderOptions {
  /** https URL or local directory. */
  tree: string;
  contact?: string;
  fetch?: FetchLike;
  now?: () => number;
  /** Per-path minimum interval between conditional requests to a remote tree. */
  floorMs?: number;
  /** Add Cloudflare `cf: { cacheTtl }` hints to fetches (Worker only). */
  cfCache?: boolean;
}

interface Entry {
  status: number;
  body: string | null;
  json?: unknown;
  etag: string | null;
  headers: Record<string, string>;
  fetchedAt: number;
  expiresAt: number;
  generatedAt: string | null;
  schemaVersion: string | null;
}

export class TreeError extends Error {
  constructor(
    message: string,
    readonly path: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "TreeError";
  }
}

export function ttlFor(path: string): number {
  if (path.startsWith("network/")) return TTL_NETWORK_MS;
  if (path.startsWith("latest/") || path.startsWith("briefings/")) return TTL_LATEST_MS;
  return TTL_STATIC_MS;
}

function parseMaxAge(cacheControl: string | undefined): number | null {
  if (!cacheControl) return null;
  const m = /max-age=(\d+)/.exec(cacheControl);
  return m ? Number(m[1]) * 1000 : null;
}

export class TreeReader {
  readonly base: string;
  readonly isRemote: boolean;
  readonly userAgent: string;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly floorMs: number;
  private readonly cfCache: boolean;
  private readonly cache = new Map<string, Entry>();
  private readonly inflight = new Map<string, Promise<Entry>>();
  /** Counters for tests and health: network requests actually issued. */
  readonly stats = { requests: 0, hits: 0, notModified: 0, notFound: 0, errors: 0 };

  constructor(opts: TreeReaderOptions) {
    this.isRemote = /^https?:\/\//i.test(opts.tree);
    this.base = this.isRemote ? opts.tree.replace(/\/+$/, "") : resolve(opts.tree);
    this.userAgent = `bioregionaltwin-mcp/${PACKAGE_VERSION} (${opts.contact ?? DEFAULT_CONTACT})`;
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
    this.now = opts.now ?? (() => Date.now());
    this.floorMs = opts.floorMs ?? REMOTE_FLOOR_MS;
    this.cfCache = opts.cfCache ?? false;
  }

  /** Absolute URL (remote) or absolute file path (local) of a tree path. */
  urlFor(path: string): string {
    return this.isRemote ? `${this.base}/${path}` : join(this.base, path);
  }

  /** The tree's `generated_at` for a path already read this process, else null. */
  generatedAt(path: string): string | null {
    return this.cache.get(path)?.generatedAt ?? null;
  }

  schemaVersion(path: string): string | null {
    return this.cache.get(path)?.schemaVersion ?? null;
  }

  etag(path: string): string | null {
    return this.cache.get(path)?.etag ?? null;
  }

  invalidate(path?: string): void {
    if (path) this.cache.delete(path);
    else this.cache.clear();
  }

  /** Parsed JSON body, or null on 404. */
  async getJson<T = unknown>(path: string): Promise<T | null> {
    const e = await this.get(path);
    if (e.body === null) return null;
    if (e.json === undefined) {
      try {
        e.json = JSON.parse(e.body);
      } catch (err) {
        throw new TreeError(`invalid JSON at ${path}: ${(err as Error).message}`, path, e.status);
      }
    }
    return e.json as T;
  }

  /** Text body, or null on 404. */
  async getText(path: string): Promise<string | null> {
    return (await this.get(path)).body;
  }

  /** True when the path exists (uses the cache; a HEAD is never cheaper on this CDN). */
  async exists(path: string): Promise<boolean> {
    return (await this.get(path)).body !== null;
  }

  private async get(path: string): Promise<Entry> {
    const now = this.now();
    const cached = this.cache.get(path);
    if (cached) {
      const fresh = now < cached.expiresAt;
      const underFloor = this.isRemote && now - cached.fetchedAt < this.floorMs;
      if (fresh || underFloor) {
        this.stats.hits++;
        return cached;
      }
    }
    const pending = this.inflight.get(path);
    if (pending) return pending;
    const p = (this.isRemote ? this.fetchRemote(path, cached) : this.readLocal(path)).finally(() =>
      this.inflight.delete(path),
    );
    this.inflight.set(path, p);
    return p;
  }

  private store(path: string, entry: Entry): Entry {
    this.cache.set(path, entry);
    return entry;
  }

  private static meta(body: string | null): { generatedAt: string | null; schemaVersion: string | null } {
    if (!body) return { generatedAt: null, schemaVersion: null };
    // Cheap, allocation-light scan: every JSON artifact carries both keys at top level.
    const g = /"generated_at":"([^"]+)"/.exec(body.slice(0, 4096)) ?? /"generated_at":\s*"([^"]+)"/.exec(body);
    const s = /"schema_version":"([^"]+)"/.exec(body.slice(0, 4096)) ?? /"schema_version":\s*"([^"]+)"/.exec(body);
    return { generatedAt: g?.[1] ?? null, schemaVersion: s?.[1] ?? null };
  }

  private async fetchRemote(path: string, cached: Entry | undefined): Promise<Entry> {
    const now = this.now();
    const ttl = ttlFor(path);
    const headers: Record<string, string> = { "User-Agent": this.userAgent, Accept: "application/json, application/geo+json, text/markdown, */*" };
    if (cached?.etag) headers["If-None-Match"] = cached.etag;
    const init: RequestInit & { cf?: Record<string, unknown> } = { method: "GET", headers, redirect: "follow" };
    if (this.cfCache) init.cf = { cacheTtl: Math.floor(ttl / 1000), cacheEverything: true };
    this.stats.requests++;
    let res: Response;
    try {
      res = await this.fetchImpl(this.urlFor(path), init);
    } catch (err) {
      this.stats.errors++;
      if (cached) return this.store(path, { ...cached, fetchedAt: now, expiresAt: now + ttl }); // stale-if-error
      throw new TreeError(`fetch failed for ${path}: ${(err as Error).message}`, path);
    }
    if (res.status === 304 && cached) {
      this.stats.notModified++;
      return this.store(path, { ...cached, fetchedAt: now, expiresAt: now + ttl });
    }
    if (res.status === 404 || res.status === 410) {
      this.stats.notFound++;
      return this.store(path, {
        status: res.status,
        body: null,
        etag: null,
        headers: {},
        fetchedAt: now,
        expiresAt: now + ttl,
        generatedAt: null,
        schemaVersion: null,
      });
    }
    if (!res.ok) {
      this.stats.errors++;
      if (cached) return this.store(path, { ...cached, fetchedAt: now, expiresAt: now + ttl });
      throw new TreeError(`GET ${path} → ${res.status}`, path, res.status);
    }
    const body = await res.text();
    const hdrs: Record<string, string> = {};
    res.headers.forEach((v, k) => (hdrs[k.toLowerCase()] = v));
    const { generatedAt, schemaVersion } = TreeReader.meta(body);
    return this.store(path, {
      status: res.status,
      body,
      etag: res.headers.get("etag"),
      headers: hdrs,
      fetchedAt: now,
      expiresAt: now + ttl,
      generatedAt,
      schemaVersion,
    });
  }

  private async readLocal(path: string): Promise<Entry> {
    const now = this.now();
    const file = this.urlFor(path);
    let body: string | null;
    try {
      body = await readFile(file, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT" || (err as NodeJS.ErrnoException).code === "ENOTDIR") body = null;
      else throw new TreeError(`read failed for ${path}: ${(err as Error).message}`, path);
    }
    let sidecar: Record<string, string> = {};
    if (body !== null) {
      try {
        sidecar = JSON.parse(await readFile(`${file}.headers.json`, "utf8")) as Record<string, string>;
      } catch {
        sidecar = {};
      }
    }
    const lower: Record<string, string> = {};
    for (const [k, v] of Object.entries(sidecar)) lower[k.toLowerCase()] = v;
    const ttl = parseMaxAge(lower["cache-control"]) ?? ttlFor(path);
    const { generatedAt, schemaVersion } = TreeReader.meta(body);
    return this.store(path, {
      status: body === null ? 404 : 200,
      body,
      etag: lower["etag"] ?? null,
      headers: lower,
      fetchedAt: now,
      expiresAt: now + ttl,
      generatedAt,
      schemaVersion,
    });
  }
}
