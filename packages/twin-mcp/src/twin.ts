/**
 * Typed reads of the tree, one function per artifact, all through the
 * `TreeReader`. Nothing here transforms; that is the tools' job.
 */

import { hucCodeOf } from "./binding.js";
import { SourceStatusIndex } from "./readings.js";
import type { TreeReader } from "./tree.js";
import type { Conditions, Feature, FeatureCollection, Geometry, HealthBoard, IdIndex, IdRecord, IndexEntry, LiveLayer, PlacePage, SnowState, Station } from "./types.js";

export const LIVE_SOURCE: Record<LiveLayer, string> = {
  alerts: "nws.alerts",
  drought: "usdm.current",
  fires: "nifc.wfigs",
  detections: "nasa.firms",
  quakes: "usgs.quakes",
};

export class NotPublished extends Error {
  constructor(readonly path: string) {
    super(`${path} is not published at this tree (404)`);
    this.name = "NotPublished";
  }
}

export const conditions = (r: TreeReader) => r.getJson<Conditions>("latest/conditions.json");
export const health = (r: TreeReader) => r.getJson<HealthBoard>("latest/health.json");
export const snow = (r: TreeReader) => r.getJson<SnowState>("latest/snow.json");
export const index = (r: TreeReader) => r.getJson<IdIndex>("id/index.json");
export const idRecord = (r: TreeReader, id: string) => r.getJson<IdRecord>(`id/${id}.json`);
export const placePage = (r: TreeReader, id: string) => r.getJson<PlacePage>(`latest/${id}.json`);
export const geom = (r: TreeReader, id: string) => r.getJson<Feature>(`geom/${id}.geojson`);
export const layer = (r: TreeReader, l: LiveLayer) => r.getJson<FeatureCollection>(`latest/${l}.geojson`);
export const boundary = (r: TreeReader, v = "v1") => r.getJson<Feature>(`boundary/${v}.geojson`);
export const boundaryText = (r: TreeReader, v = "v1") => r.getText(`boundary/${v}.md`);

export async function requireConditions(r: TreeReader): Promise<Conditions> {
  const c = await conditions(r);
  if (!c) throw new NotPublished("latest/conditions.json");
  return c;
}

export async function requireIndex(r: TreeReader): Promise<IdIndex> {
  const i = await index(r);
  if (!i) throw new NotPublished("id/index.json");
  return i;
}

export async function sourceIndex(r: TreeReader): Promise<SourceStatusIndex> {
  const [c, h] = await Promise.all([conditions(r), health(r)]);
  return new SourceStatusIndex(c, h);
}

export function stationsById(c: Conditions): Map<string, Station> {
  return new Map(c.stations.map((s) => [s.id, s]));
}

export function indexById(i: IdIndex): Map<string, IndexEntry> {
  return new Map(i.places.map((p) => [p.id, p]));
}

/** The polygon (or point) of a place, or null when unpublished/geometryless. */
export async function geometryOf(r: TreeReader, id: string): Promise<Geometry | null> {
  const f = await geom(r, id);
  return f?.geometry ?? null;
}

/** HUC filter: a station or watershed matches `huc` when its code starts with it. */
export function matchesHuc(entry: { id: string; huc12?: string | null }, huc: string): boolean {
  if (entry.huc12?.startsWith(huc)) return true;
  const code = hucCodeOf(entry.id);
  return !!code && (code.startsWith(huc) || huc.startsWith(code));
}

/** The public base URL to print in `points_url`/`geometry_url` for a local tree. */
export function publicBase(r: TreeReader): string {
  return r.isRemote ? r.base : "https://data.bioregionaltwin.org";
}
