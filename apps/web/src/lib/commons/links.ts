/**
 * Links into the front-range commons (ADR-E08). Wikilinks create graph edges
 * only as `[[full/vault/path]]` (survey §7.3); cross-vault resolution is
 * *verify* (docs/verify.md #6), so every wikilink is followed by the
 * absolute note URL as a fallback that works regardless.
 */
import { encodeNotePath } from "./client";

export const DEFAULT_FRONT_RANGE_BASE = "https://prism.omniharmonic.com/p/front-range";

/** `watershed/huc10-1019000504` → `wiki/places/watersheds/huc1019000504` (the level prefix is stripped, survey §7.1). */
export function watershedShelfPath(id: string): string | null {
  const m = /^watershed\/huc\d+-(\d+)$/.exec(id);
  return m ? `wiki/places/watersheds/huc${m[1]}` : null;
}

/** `place/<slug>` → `wiki/places/monitoring/<slug>` (monitoring stubs are by name slug, survey §7.1). */
export function monitoringShelfPath(id: string): string | null {
  const m = /^place\/([a-z0-9-]+)$/.exec(id);
  return m ? `wiki/places/monitoring/${m[1]}` : null;
}

export function shelfPathFor(id: string): string | null {
  return watershedShelfPath(id) ?? monitoringShelfPath(id);
}

export function absoluteNoteUrl(path: string, base = DEFAULT_FRONT_RANGE_BASE): string {
  return `${base.replace(/\/+$/, "")}/notes/${encodeNotePath(path)}`;
}

/** `[[wiki/places/watersheds/huc1019000504]] (https://…/notes/wiki%2Fplaces%2F…)` */
export function commonsLink(id: string, label?: string, base = DEFAULT_FRONT_RANGE_BASE): string {
  const path = shelfPathFor(id);
  if (!path) return label ?? id;
  const wl = label ? `[[${path}|${label}]]` : `[[${path}]]`;
  return `${wl} (${absoluteNoteUrl(path, base)})`;
}
