/**
 * Bounding boxes only. This module reads GeoJSON geometry to compute a bbox
 * and nothing here is ever returned to a tool output, a prompt or a file —
 * the needs job keeps bboxes in local variables (CLAUDE.md: no `coordinates`
 * key crosses a boundary).
 *
 * The intersection test is bbox-vs-bbox. That is an approximation: a bbox
 * overlap can be true where the polygons themselves do not touch (a concave
 * watershed and a drought polygon that only clips its bounding rectangle), so
 * `max_intersecting` and alert matching may OVER-count, never under-count.
 * The twin MCP's `get_entity_status` does the finer centroid/vertex test on
 * the same inputs; the two agree whenever the coarse test is negative.
 */
import type { Geometry } from "@kami/twin-client";

export type BBox = [number, number, number, number];

function positions(g: Geometry | null | undefined): number[][] {
  if (!g) return [];
  switch (g.type) {
    case "Point":
      return [g.coordinates];
    case "MultiPoint":
    case "LineString":
      return g.coordinates;
    case "Polygon":
    case "MultiLineString":
      return g.coordinates.flat();
    case "MultiPolygon":
      return g.coordinates.flat(2);
    case "GeometryCollection":
      return g.geometries.flatMap(positions);
    default:
      return [];
  }
}

export function bboxOfGeometry(g: Geometry | null | undefined): BBox | null {
  const pts = positions(g);
  if (pts.length === 0) return null;
  let minx = Infinity,
    miny = Infinity,
    maxx = -Infinity,
    maxy = -Infinity;
  for (const p of pts) {
    const x = p[0],
      y = p[1];
    if (typeof x !== "number" || typeof y !== "number") continue;
    if (x < minx) minx = x;
    if (y < miny) miny = y;
    if (x > maxx) maxx = x;
    if (y > maxy) maxy = y;
  }
  return Number.isFinite(minx) ? [minx, miny, maxx, maxy] : null;
}

/** A published `bbox` array → BBox, or null when malformed. */
export function bboxFrom(arr: number[] | null | undefined): BBox | null {
  if (!arr || arr.length < 4) return null;
  const [a, b, c, d] = arr;
  if ([a, b, c, d].some((n) => typeof n !== "number" || !Number.isFinite(n))) return null;
  return [a!, b!, c!, d!];
}

export function bboxesOverlap(a: BBox | null, b: BBox | null): boolean {
  if (!a || !b) return false;
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

export function overlapsAny(a: BBox | null, boxes: readonly BBox[]): boolean {
  return boxes.some((b) => bboxesOverlap(a, b));
}
