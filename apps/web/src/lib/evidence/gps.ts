/**
 * GPS distance against the bounty's anchor. The anchor (the place bbox
 * centroid) is supplied by the caller: no geometry is stored or emitted here
 * beyond a single lat/lon pair that never reaches a tool output or a prompt.
 */
export type LatLon = { lat: number; lon: number };

const R = 6_371_008.8; // mean Earth radius, metres

export function haversineMetres(a: LatLon, b: LatLon): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function withinMetres(point: LatLon | null | undefined, anchor: LatLon | null | undefined, metres: number): boolean | null {
  if (!point || !anchor) return null;
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) return null;
  return haversineMetres(point, anchor) <= metres;
}

/** Centroid of a `[west, south, east, north]` bbox. */
export function bboxCentroid(bbox: readonly number[] | null | undefined): LatLon | null {
  if (!bbox || bbox.length !== 4 || !bbox.every((n) => Number.isFinite(n))) return null;
  const [w, s, e, n] = bbox as [number, number, number, number];
  return { lat: (s + n) / 2, lon: (w + e) / 2 };
}
