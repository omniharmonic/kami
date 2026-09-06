/**
 * `TwinClient` — reads the twin like a browser does (ADR-E01).
 *
 * - anonymous GETs only; no write path exists and none is modelled here
 * - `User-Agent: kami/<ver> (<contact>)` on every request (the twin's own
 *   fetcher does the same; api.weather.gov 403s without one — survey §9.5)
 * - per-path ETag cache with `If-None-Match`; a 304 serves the cached body
 * - a per-path floor (default 60 s, ADR-E01 "never exceeds once per 60 s"):
 *   a second call inside the floor returns the cache without a network hit,
 *   `force` or not — the floor is a promise to the twin, not a hint
 * - 404 → `null`: a meaningful state in this tree (a pruned place, a
 *   proposed-but-unbuilt prefix — survey Appendix #6)
 * - network error or 5xx → `TwinUnreachable`, carrying the last cached body
 *   so a caller can degrade to "stale, not dark"
 * - `localDir` mode reads the same paths from disk (a fixture tree; the
 *   sandbox cannot reach data.bioregionaltwin.org)
 */

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { isAbsolute, join, normalize, sep } from "node:path";
import type { ZodType } from "zod";

import {
  BoundaryFeatureSchema,
  BriefingSchema,
  ConditionsSchema,
  FlowNetworkSchema,
  HealthBoardSchema,
  IdIndexSchema,
  IdRecordSchema,
  LiveCollectionSchema,
  NormalsSchema,
  PlacePageSchema,
  ReachCollectionSchema,
  SnowStateSchema,
  TilesManifestSchema,
} from "./schemas.js";
import type {
  BoundaryFeature,
  Briefing,
  Conditions,
  FlowNetwork,
  HealthBoard,
  IdIndex,
  IdRecord,
  LiveCollection,
  LiveLayer,
  LivePropsByLayer,
  Normals,
  PlacePage,
  ReachCollection,
  SnowState,
  Station,
  TilesManifest,
} from "./types.js";

export const DEFAULT_BASE_URL = "https://data.bioregionaltwin.org";
export const DEFAULT_MIN_INTERVAL_MS = 60_000;

/** `sources/ids-schema.json` line 13 — the only id shape the twin mints. */
export const PLACE_ID_PATTERN = /^[a-z_]+\/[a-z0-9-]+$/;

export function isPlaceId(id: string): boolean {
  return PLACE_ID_PATTERN.test(id);
}

function assertPlaceId(id: string): void {
  if (!isPlaceId(id)) throw new TypeError(`not a twin place id: ${JSON.stringify(id)}`);
}

export interface TwinClientOptions {
  /** Origin of the published tree. Ignored when `localDir` is set. */
  baseUrl?: string;
  /** Read the tree from a directory instead of the network (fixtures). */
  localDir?: string;
  /** `kami/<ver> (<contact>)` — sent on every request. Required. */
  userAgent: string;
  /** Per-path floor between network hits. Default 60 000. */
  minIntervalMs?: number;
  /** Injected `fetch` (tests). Defaults to the global. */
  fetchImpl?: typeof fetch;
  /** Injected clock in ms (tests). Defaults to `Date.now`. */
  now?: () => number;
}

export interface TwinMeta {
  /** The tree-relative path, e.g. "latest/conditions.json". */
  path: string;
  /** The ETag the origin returned (or a content hash in local mode); null when none. */
  etag: string | null;
  /** The artifact's own `generated_at`, when it has one. Not a clock on cached pages (survey §1.2). */
  generated_at: string | null;
  /** When this client last touched the origin for this path (ISO, ms precision). */
  fetched_at: string;
  /** True when the body came from this client's cache (floor or 304) rather than a fresh 200. */
  from_cache: boolean;
}

export interface TwinResponse<T> {
  data: T;
  meta: TwinMeta;
}

/** The origin could not be reached (or answered 5xx). `cached` is the last good body for this path, if any. */
export class TwinUnreachable extends Error {
  override name = "TwinUnreachable";
  constructor(
    public readonly path: string,
    public readonly cached: unknown | null,
    public readonly status: number | null,
    options?: { cause?: unknown },
  ) {
    super(
      status === null
        ? `twin unreachable at ${path}`
        : `twin answered ${status} at ${path}`,
      options,
    );
  }
}

/** The origin answered with a body this client cannot type — a contract break, not a network problem. */
export class TwinContractError extends Error {
  override name = "TwinContractError";
  constructor(
    public readonly path: string,
    public readonly issues: unknown,
  ) {
    super(`twin artifact at ${path} does not match the expected shape`);
  }
}

interface CacheEntry {
  status: 200 | 404;
  body: unknown | null;
  etag: string | null;
  generated_at: string | null;
  /** ms since epoch of the last origin contact. */
  fetched_at: number;
}

interface RawResult {
  entry: CacheEntry;
  from_cache: boolean;
}

export interface GetOptions {
  /**
   * Skip the conditional request and refetch the body outright. The per-path
   * floor still applies: inside it you get the cache regardless.
   */
  force?: boolean;
}

function generatedAtOf(body: unknown): string | null {
  if (body && typeof body === "object" && typeof (body as { generated_at?: unknown }).generated_at === "string") {
    return (body as { generated_at: string }).generated_at;
  }
  return null;
}

function isText(path: string): boolean {
  return path.endsWith(".md") || path.endsWith(".txt");
}

export class TwinClient {
  readonly baseUrl: string;
  readonly localDir: string | null;
  readonly userAgent: string;
  readonly minIntervalMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<RawResult>>();

  constructor(options: TwinClientOptions) {
    if (!options.userAgent || !options.userAgent.trim()) {
      throw new TypeError("TwinClient requires a userAgent of the form 'kami/<ver> (<contact>)'");
    }
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.localDir = options.localDir ?? null;
    this.userAgent = options.userAgent;
    this.minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
  }

  /** The absolute URL a path resolves to (network mode). */
  urlFor(path: string): string {
    return `${this.baseUrl}/${path.replace(/^\/+/, "")}`;
  }

  /** Peek at the cache without touching the origin. */
  cached(path: string): unknown | null {
    return this.cache.get(path)?.body ?? null;
  }

  /** Forget one path (or everything). Tests and "the steward asked for a refresh" only. */
  invalidate(path?: string): void {
    if (path === undefined) this.cache.clear();
    else this.cache.delete(path);
  }

  // --- raw fetch -------------------------------------------------------------

  /** Untyped GET honouring the floor, the ETag cache and the 404 → null rule. */
  async get(path: string, options: GetOptions = {}): Promise<{ body: unknown | null; meta: TwinMeta }> {
    const raw = await this.raw(path, options);
    return {
      body: raw.entry.body,
      meta: {
        path,
        etag: raw.entry.etag,
        generated_at: raw.entry.generated_at,
        fetched_at: new Date(raw.entry.fetched_at).toISOString(),
        from_cache: raw.from_cache,
      },
    };
  }

  private raw(path: string, options: GetOptions): Promise<RawResult> {
    const hit = this.cache.get(path);
    if (hit && this.now() - hit.fetched_at < this.minIntervalMs) {
      return Promise.resolve({ entry: hit, from_cache: true });
    }
    const pending = this.inflight.get(path);
    if (pending) return pending;
    const p = (this.localDir ? this.readLocal(path) : this.readNetwork(path, hit, options)).finally(() =>
      this.inflight.delete(path),
    );
    this.inflight.set(path, p);
    return p;
  }

  private async readLocal(path: string): Promise<RawResult> {
    const rel = normalize(path.replace(/^\/+/, ""));
    if (isAbsolute(rel) || rel.split(sep).includes("..")) {
      throw new TypeError(`refusing path outside the tree: ${path}`);
    }
    const file = join(this.localDir as string, rel);
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        const entry: CacheEntry = { status: 404, body: null, etag: null, generated_at: null, fetched_at: this.now() };
        this.cache.set(path, entry);
        return { entry, from_cache: false };
      }
      throw new TwinUnreachable(path, this.cache.get(path)?.body ?? null, null, { cause: err });
    }
    const body = isText(path) ? text : this.parseJson(path, text);
    const etag = `"sha256-${createHash("sha256").update(text).digest("hex").slice(0, 16)}"`;
    const entry: CacheEntry = { status: 200, body, etag, generated_at: generatedAtOf(body), fetched_at: this.now() };
    this.cache.set(path, entry);
    return { entry, from_cache: false };
  }

  private async readNetwork(path: string, prior: CacheEntry | undefined, options: GetOptions): Promise<RawResult> {
    const headers: Record<string, string> = {
      "User-Agent": this.userAgent,
      Accept: isText(path) ? "text/markdown, text/plain;q=0.9, */*;q=0.1" : "application/json, application/geo+json;q=0.9, */*;q=0.1",
    };
    if (prior?.etag && !options.force && prior.status === 200) headers["If-None-Match"] = prior.etag;

    let res: Response;
    try {
      res = await this.fetchImpl(this.urlFor(path), { method: "GET", headers, redirect: "follow" });
    } catch (err) {
      throw new TwinUnreachable(path, prior?.body ?? null, null, { cause: err });
    }

    if (res.status === 304 && prior && prior.status === 200) {
      const entry: CacheEntry = { ...prior, fetched_at: this.now() };
      this.cache.set(path, entry);
      return { entry, from_cache: true };
    }
    if (res.status === 404) {
      const entry: CacheEntry = { status: 404, body: null, etag: null, generated_at: null, fetched_at: this.now() };
      this.cache.set(path, entry);
      return { entry, from_cache: false };
    }
    if (!res.ok) {
      throw new TwinUnreachable(path, prior?.body ?? null, res.status);
    }
    let text: string;
    try {
      text = await res.text();
    } catch (err) {
      throw new TwinUnreachable(path, prior?.body ?? null, null, { cause: err });
    }
    const body = isText(path) ? text : this.parseJson(path, text);
    const entry: CacheEntry = {
      status: 200,
      body,
      etag: res.headers.get("etag"),
      generated_at: generatedAtOf(body),
      fetched_at: this.now(),
    };
    this.cache.set(path, entry);
    return { entry, from_cache: false };
  }

  private parseJson(path: string, text: string): unknown {
    try {
      return JSON.parse(text);
    } catch (err) {
      throw new TwinContractError(path, { message: "body is not JSON", cause: String(err) });
    }
  }

  // --- typed getters -----------------------------------------------------------

  private async typed<T>(path: string, schema: ZodType<T>, options?: GetOptions): Promise<TwinResponse<T> | null> {
    const { body, meta } = await this.get(path, options);
    if (body === null) return null;
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new TwinContractError(path, parsed.error.issues);
    return { data: parsed.data, meta };
  }

  /** `id/index.json` — every published, active place (survey §3.3). */
  index(options?: GetOptions) {
    return this.typed<IdIndex>("id/index.json", IdIndexSchema as unknown as ZodType<IdIndex>, options);
  }

  /** `id/<id>.json` — the identity record. `null` = not published (pruned or superseded). */
  async idRecord(id: string, options?: GetOptions): Promise<TwinResponse<IdRecord> | null> {
    assertPlaceId(id);
    return this.typed<IdRecord>(`id/${id}.json`, IdRecordSchema as unknown as ZodType<IdRecord>, options);
  }

  /** `latest/<id>.json` — the place page (threshold dialect). Survives supersession. */
  async placePage(id: string, options?: GetOptions): Promise<TwinResponse<PlacePage> | null> {
    assertPlaceId(id);
    return this.typed<PlacePage>(`latest/${id}.json`, PlacePageSchema as unknown as ZodType<PlacePage>, options);
  }

  /** `latest/conditions.json` — every monitoring_site with a reading (verdict dialect). */
  conditions(options?: GetOptions) {
    return this.typed<Conditions>("latest/conditions.json", ConditionsSchema as unknown as ZodType<Conditions>, options);
  }

  /** `latest/health.json` — the source health board. */
  health(options?: GetOptions) {
    return this.typed<HealthBoard>("latest/health.json", HealthBoardSchema as unknown as ZodType<HealthBoard>, options);
  }

  /** `latest/snow.json` — the measured snowline; 404 is `null`, not an error. */
  snow(options?: GetOptions) {
    return this.typed<SnowState>("latest/snow.json", SnowStateSchema as unknown as ZodType<SnowState>, options);
  }

  /** `latest/<layer>.geojson` — one of the five live collections. `geometry` may be null per feature. */
  live<L extends LiveLayer>(layer: L, options?: GetOptions) {
    return this.typed<LiveCollection<LivePropsByLayer[L]>>(
      `latest/${layer}.geojson`,
      LiveCollectionSchema as unknown as ZodType<LiveCollection<LivePropsByLayer[L]>>,
      options,
    );
  }

  /** `boundary/v1.geojson` — the Ring A polygon, a single Feature. A boundary is a proposal; read the rationale beside it. */
  boundary(options?: GetOptions) {
    return this.typed<BoundaryFeature>("boundary/v1.geojson", BoundaryFeatureSchema as unknown as ZodType<BoundaryFeature>, options);
  }

  /** `boundary/v1.md` — the rationale, byte-for-byte (prose: CC BY-SA 4.0). */
  async boundaryRationale(options?: GetOptions): Promise<TwinResponse<string> | null> {
    const { body, meta } = await this.get("boundary/v1.md", options);
    if (body === null) return null;
    if (typeof body !== "string") throw new TwinContractError("boundary/v1.md", { message: "expected text" });
    return { data: body, meta };
  }

  /** `latest/flow_network.json` — may 404 until the NHDPlus branch lands (survey §1.1). */
  flowNetwork(options?: GetOptions) {
    return this.typed<FlowNetwork>("latest/flow_network.json", FlowNetworkSchema as unknown as ZodType<FlowNetwork>, options);
  }

  /** `network/reaches.geojson` — may 404 until the NHDPlus branch lands. */
  reaches(options?: GetOptions) {
    return this.typed<ReachCollection>("network/reaches.geojson", ReachCollectionSchema as unknown as ZodType<ReachCollection>, options);
  }

  /** `tiles/manifest.json`. */
  tilesManifest(options?: GetOptions) {
    return this.typed<TilesManifest>("tiles/manifest.json", TilesManifestSchema as unknown as ZodType<TilesManifest>, options);
  }

  /**
   * `normals/<id>.json` — NOT PUBLISHED TODAY (survey §2.7, proposal not
   * approved). Returns `null` until the twin ships it; `compare_to_normal`
   * must answer `{available:false}` on `null`.
   */
  async normals(id: string, options?: GetOptions): Promise<TwinResponse<Normals> | null> {
    assertPlaceId(id);
    return this.typed<Normals>(`normals/${id}.json`, NormalsSchema as unknown as ZodType<Normals>, options);
  }

  /** `briefings/latest.json` — SPECIFIED, NOT BUILT (survey §6). `null` until it ships. */
  briefing(options?: GetOptions) {
    return this.typed<Briefing>("briefings/latest.json", BriefingSchema as unknown as ZodType<Briefing>, options);
  }
}

// --- helpers over conditions.json -------------------------------------------------

/** Stations whose `huc12` is in the set. Stations without a `huc12` never match. */
export function stationsForHuc12s(conditions: Conditions, huc12s: Iterable<string>): Station[] {
  const set = new Set(huc12s);
  return conditions.stations.filter((s) => typeof s.huc12 === "string" && set.has(s.huc12));
}

/** Stations by id, in the order of `ids`; ids absent from conditions (no reading today) are skipped. */
export function stationsForIds(conditions: Conditions, ids: Iterable<string>): Station[] {
  const byId = new Map(conditions.stations.map((s) => [s.id, s] as const));
  const out: Station[] = [];
  for (const id of ids) {
    const s = byId.get(id);
    if (s) out.push(s);
  }
  return out;
}
