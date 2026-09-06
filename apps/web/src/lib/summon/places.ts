/**
 * Step 1's place search: the twin's `id/index.json`, filtered the way the twin
 * MCP's `find_places` filters it (name/id substring, kind, HUC prefix), capped
 * and paginated. Server-side only — the browser never talks to the twin, so
 * the 60 s per-path floor stays a promise the platform can keep (ADR-E01).
 */
import { TwinUnreachable, type IdIndexEntry, type TwinClient } from "@kami/twin-client";

export const MAX_LIMIT = 25;
export const DEFAULT_LIMIT = 10;

export type PlaceHit = {
  id: string;
  kind: string;
  name: string;
  huc12: string | null;
  /** true when this id already anchors a live kami (siblings, §4.4) */
  bound?: boolean;
};

export type PlaceSearchResult = {
  places: PlaceHit[];
  total: number;
  /** offset of the next page, or null */
  next_cursor: string | null;
  index_count: number;
  /** the twin generated_at, so the page can say how fresh the registry is */
  generated_at: string | null;
  kinds: string[];
};

export class TwinSearchUnavailable extends Error {
  override name = "TwinSearchUnavailable";
  constructor(public readonly path: string) {
    super(`the twin is not answering at ${path}`);
  }
}

export type SearchOptions = {
  query?: string | undefined;
  kind?: string | undefined;
  /** 2–12 digits */
  huc?: string | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
};

function matchesHuc(entry: IdIndexEntry, huc: string): boolean {
  if (typeof entry.huc12 === "string" && entry.huc12.startsWith(huc)) return true;
  // watershed ids carry their code: watershed/huc10-1019000504
  const m = /^watershed\/huc(\d{1,2})-(\d+)$/.exec(entry.id);
  return m ? m[2]!.startsWith(huc) : false;
}

export function parseCursor(cursor: string | undefined): number {
  const n = Number(cursor ?? 0);
  return Number.isInteger(n) && n >= 0 && n < 100_000 ? n : 0;
}

/** Case-insensitive substring on name or id, plus the kind and HUC filters. */
export async function searchPlaces(tree: TwinClient, options: SearchOptions = {}): Promise<PlaceSearchResult> {
  let index;
  try {
    index = await tree.index();
  } catch (err) {
    if (err instanceof TwinUnreachable) throw new TwinSearchUnavailable("id/index.json");
    throw err;
  }
  if (!index) throw new TwinSearchUnavailable("id/index.json");

  const q = options.query?.trim().toLowerCase();
  const kind = options.kind?.trim() || undefined;
  const huc = options.huc?.trim() || undefined;
  if (huc && !/^\d{2,12}$/.test(huc)) throw new TypeError("huc must be 2–12 digits");

  const all = index.data.places;
  const hits = all.filter((p) => {
    if (q && !(p.name.toLowerCase().includes(q) || p.id.includes(q))) return false;
    if (kind && p.kind !== kind) return false;
    if (huc && !matchesHuc(p, huc)) return false;
    return true;
  });
  // watersheds first (a creator picks a stream or a basin far more often than a
  // single gauge), then by name — deterministic for a given tree.
  const rank = (p: IdIndexEntry) => (p.kind === "watershed" ? 0 : p.kind === "monitoring_site" ? 1 : 2);
  hits.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

  const limit = Math.max(1, Math.min(MAX_LIMIT, options.limit ?? DEFAULT_LIMIT));
  const start = parseCursor(options.cursor);
  const page = hits.slice(start, start + limit);
  const end = start + page.length;

  return {
    places: page.map((p) => ({ id: p.id, kind: p.kind, name: p.name.trim(), huc12: p.huc12 ?? null })),
    total: hits.length,
    next_cursor: end < hits.length ? String(end) : null,
    index_count: index.data.count ?? all.length,
    generated_at: index.meta.generated_at,
    kinds: [...new Set(all.map((p) => p.kind))].sort(),
  };
}
