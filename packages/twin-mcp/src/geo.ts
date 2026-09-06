/**
 * The only geometry code in the package, and it never leaves the server:
 * ray-casting point-in-polygon and bbox/centroid helpers used to answer
 * `within` and `max_intersecting` server-side. Outputs carry centroids and
 * bboxes at most — see `assertNoGeometry`.
 */

import type { Geometry, Position } from "./types.js";

export type BBox = [number, number, number, number];

function inRing(lon: number, lat: number, ring: Position[]): boolean {
  // Even-odd rule (ray cast east along +lon).
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]![0]!, yi = ring[i]![1]!;
    const xj = ring[j]![0]!, yj = ring[j]![1]!;
    const intersects = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function inPolygon(lon: number, lat: number, rings: Position[][]): boolean {
  if (rings.length === 0 || !inRing(lon, lat, rings[0]!)) return false;
  for (let h = 1; h < rings.length; h++) if (inRing(lon, lat, rings[h]!)) return false;
  return true;
}

/** True when (lon, lat) falls inside a Polygon or MultiPolygon (holes honoured). */
export function pointInPolygon(lon: number, lat: number, geometry: Geometry | null | undefined): boolean {
  if (!geometry) return false;
  switch (geometry.type) {
    case "Polygon":
      return inPolygon(lon, lat, geometry.coordinates);
    case "MultiPolygon":
      return geometry.coordinates.some((poly) => inPolygon(lon, lat, poly));
    case "GeometryCollection":
      return geometry.geometries.some((g) => pointInPolygon(lon, lat, g));
    default:
      return false;
  }
}

export function positionsOf(geometry: Geometry | null | undefined): Position[] {
  if (!geometry) return [];
  switch (geometry.type) {
    case "Point":
      return [geometry.coordinates];
    case "MultiPoint":
    case "LineString":
      return geometry.coordinates;
    case "Polygon":
    case "MultiLineString":
      return geometry.coordinates.flat();
    case "MultiPolygon":
      return geometry.coordinates.flat(2);
    case "GeometryCollection":
      return geometry.geometries.flatMap(positionsOf);
  }
}

export function bboxOf(geometry: Geometry | null | undefined): BBox | null {
  const pts = positionsOf(geometry);
  if (pts.length === 0) return null;
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const p of pts) {
    const x = p[0]!, y = p[1]!;
    if (x < minx) minx = x;
    if (y < miny) miny = y;
    if (x > maxx) maxx = x;
    if (y > maxy) maxy = y;
  }
  return [minx, miny, maxx, maxy];
}

export function bboxesOverlap(a: BBox | null, b: BBox | null): boolean {
  if (!a || !b) return false;
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * A representative point: the point itself for a Point, the bbox centre for
 * anything else. Rounded to 6 decimals like the publisher's `GEOM_PRECISION`.
 * This is a centroid in the loose, cartographic sense the contract allows.
 */
export function centroidOf(geometry: Geometry | null | undefined): [number, number] | null {
  if (!geometry) return null;
  if (geometry.type === "Point") return [round6(geometry.coordinates[0]!), round6(geometry.coordinates[1]!)];
  const b = bboxOf(geometry);
  return b ? [round6((b[0] + b[2]) / 2), round6((b[1] + b[3]) / 2)] : null;
}

/**
 * Approximate intersection of two geometries, good enough for "does this
 * drought polygon touch this watershed": bboxes must overlap, and then any
 * vertex of either inside the other, or either centroid inside the other,
 * counts. This is not a full polygon-clipping test — two polygons whose edges
 * cross with no vertex of either inside the other would be missed — but USDM
 * classes are nested county-scale blobs and HUC-10s are contiguous, so the
 * miss case does not arise in practice. Documented as an approximation.
 */
export function geometriesIntersectApprox(a: Geometry | null | undefined, b: Geometry | null | undefined): boolean {
  if (!a || !b) return false;
  if (!bboxesOverlap(bboxOf(a), bboxOf(b))) return false;
  const ca = centroidOf(a), cb = centroidOf(b);
  if (ca && pointInPolygon(ca[0], ca[1], b)) return true;
  if (cb && pointInPolygon(cb[0], cb[1], a)) return true;
  if (positionsOf(a).some((p) => pointInPolygon(p[0]!, p[1]!, b))) return true;
  if (positionsOf(b).some((p) => pointInPolygon(p[0]!, p[1]!, a))) return true;
  return false;
}

/** True when `pt` (lon, lat) is inside `polygon`, or — when `polygon` has no
 * area (a Point place) — within `radiusDeg` of it. */
export function pointWithin(lon: number, lat: number, polygon: Geometry | null | undefined): boolean {
  if (!polygon) return false;
  if (polygon.type === "Point") {
    const [px, py] = polygon.coordinates;
    return Math.abs(px! - lon) < 1e-6 && Math.abs(py! - lat) < 1e-6;
  }
  return pointInPolygon(lon, lat, polygon);
}
