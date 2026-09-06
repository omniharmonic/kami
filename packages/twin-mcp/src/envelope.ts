/**
 * The output contract every tool result obeys (architecture §4.1):
 * `{ as_of, schema_version, tree_generated_at, ...payload }`, no geometry, at
 * most 16 KB, lists paginated with `cursor` + `limit ≤ 50`.
 */

export const MAX_OUTPUT_BYTES = 16 * 1024;
export const MAX_PAGE = 50;
export const DEFAULT_PAGE = 25;

export interface EnvelopeMeta {
  as_of: string;
  schema_version: string | null;
  tree_generated_at: string | null;
}

export type Envelope<T extends object> = EnvelopeMeta & T;

export function envelope<T extends object>(meta: EnvelopeMeta, payload: T): Envelope<T> {
  return { as_of: meta.as_of, schema_version: meta.schema_version, tree_generated_at: meta.tree_generated_at, ...payload };
}

export class ContractViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractViolation";
  }
}

const RING_TYPES = new Set(["Polygon", "MultiPolygon", "LineString", "MultiLineString", "MultiPoint", "GeometryCollection", "Point"]);

/**
 * Throws if any key named `coordinates` appears anywhere, or any key named
 * `geometry` holds a GeoJSON geometry object (a ring, a line, a point set).
 * `geometry: null` is allowed (a zone-only alert); so are centroids, bboxes
 * and `geometry_url`s.
 */
export function assertNoGeometry(output: unknown, path = "$"): void {
  if (output === null || typeof output !== "object") return;
  if (Array.isArray(output)) {
    output.forEach((v, i) => assertNoGeometry(v, `${path}[${i}]`));
    return;
  }
  for (const [k, v] of Object.entries(output as Record<string, unknown>)) {
    if (k === "coordinates") throw new ContractViolation(`geometry leaked: key "coordinates" at ${path}.${k}`);
    if (k === "geometry" && v !== null && typeof v === "object") {
      const type = (v as { type?: unknown }).type;
      if ((typeof type === "string" && RING_TYPES.has(type)) || "coordinates" in (v as object) || "geometries" in (v as object)) {
        throw new ContractViolation(`geometry leaked: GeoJSON geometry at ${path}.${k}`);
      }
    }
    assertNoGeometry(v, `${path}.${k}`);
  }
}

export function byteLength(output: unknown): number {
  return new TextEncoder().encode(JSON.stringify(output)).length;
}

export function assertSize(output: unknown, max = MAX_OUTPUT_BYTES): void {
  const n = byteLength(output);
  if (n > max) throw new ContractViolation(`output is ${n} bytes; the contract caps tool outputs at ${max}`);
}

export interface Page<T> {
  items: T[];
  next_cursor?: string;
  total: number;
}

export function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string | undefined | null): number {
  if (!cursor) return 0;
  const n = Number(Buffer.from(cursor, "base64url").toString("utf8"));
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`bad cursor: ${cursor}`);
  return n;
}

/** Offset pagination with an opaque cursor. `limit` is clamped to 1..50. */
export function paginate<T>(items: readonly T[], cursor?: string | null, limit?: number | null): Page<T> {
  const lim = Math.max(1, Math.min(MAX_PAGE, Math.floor(limit ?? DEFAULT_PAGE)));
  const start = decodeCursor(cursor);
  const slice = items.slice(start, start + lim);
  const page: Page<T> = { items: slice, total: items.length };
  if (start + lim < items.length) page.next_cursor = encodeCursor(start + lim);
  return page;
}

/**
 * Pagination that also respects the size cap: the page is shrunk from the end
 * until `sizeOf(items)` fits, and `next_cursor` points at the first item that
 * did not. A single oversized item is returned alone (the caller's
 * `assertSize` will then say so).
 */
export function paginateFit<T>(
  items: readonly T[],
  cursor: string | undefined | null,
  limit: number | undefined | null,
  sizeOf: (page: T[]) => number,
  budget = MAX_OUTPUT_BYTES - 512,
): Page<T> {
  const lim = Math.max(1, Math.min(MAX_PAGE, Math.floor(limit ?? DEFAULT_PAGE)));
  const start = decodeCursor(cursor);
  let slice = items.slice(start, start + lim);
  while (slice.length > 1 && sizeOf(slice) > budget) slice = slice.slice(0, -1);
  const page: Page<T> = { items: slice, total: items.length };
  if (start + slice.length < items.length) page.next_cursor = encodeCursor(start + slice.length);
  return page;
}
