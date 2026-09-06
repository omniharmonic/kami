/**
 * `evidence_summary` — the ONLY shape the model ever sees (arch §10.1,
 * T2.8). Structured counts plus one note of at most 500 characters with URLs
 * stripped and whitespace collapsed. No file names, no captions, no EXIF
 * strings, no free text beyond the trimmed note.
 */
import { withinMetres, type LatLon } from "./gps";
import type { EvidenceFileFacts, SpecCheck } from "./spec";

export const NOTE_MAX_CHARS = 500;

export type EvidenceSummary = {
  photo_count: number;
  exif_ok_count: number;
  gps_within_spec_count: number;
  captured_at_range: { from: string; to: string } | null;
  in_app_capture_count: number;
  note: string;
  spec_check?: SpecCheck;
};

const URL_RE = /\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s<>"')\]]+/gi;
const BARE_DOMAIN_RE = /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|io|xyz|co|info|biz|app|dev|me|ru|cn|eth|link|top|site|online)\b(?:\/[^\s]*)?/gi;

// C0/C1 controls (except plain whitespace, collapsed later), zero-width and
// bidi characters, and the BOM — never let them into a prompt. Built from code
// points so no invisible byte lives in this source file.
const CONTROL_RE = new RegExp(
  "[" +
    "\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f-\\u009f" + // C0/C1 minus \t \n \r
    "\\u00ad\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u2064\\ufeff" + // soft hyphen, ZW*, bidi, word joiners, BOM
    "]",
  "g",
);

/** Strip URLs (scheme, www., and bare domains), collapse whitespace, cap length. */
export function sanitizeNote(note: string | null | undefined, max = NOTE_MAX_CHARS): string {
  if (!note) return "";
  let s = String(note).replace(CONTROL_RE, "");
  s = s.replace(URL_RE, "").replace(BARE_DOMAIN_RE, "");
  s = s.replace(/\s+/g, " ").trim();
  if (s.length > max) s = s.slice(0, max).trimEnd();
  return s;
}

export function buildEvidenceSummary(
  files: EvidenceFileFacts[],
  note: string | null | undefined,
  ctx: { gps_within_m?: number | null; anchor?: LatLon | null; spec_check?: SpecCheck } = {},
): EvidenceSummary {
  const photos = files.filter((f) => !f.mime || f.mime.startsWith("image/"));
  const times = photos.map((f) => f.captured_at).filter((d): d is Date => d instanceof Date && !Number.isNaN(d.getTime()));
  let gpsWithin = 0;
  for (const f of photos) {
    if (ctx.gps_within_m && ctx.anchor) {
      if (withinMetres(f.gps, ctx.anchor, ctx.gps_within_m) === true) gpsWithin++;
    } else if (f.gps) gpsWithin++;
  }
  const summary: EvidenceSummary = {
    photo_count: photos.length,
    exif_ok_count: photos.filter((f) => f.exif_present && f.captured_at).length,
    gps_within_spec_count: gpsWithin,
    captured_at_range: times.length
      ? {
          from: new Date(Math.min(...times.map((t) => t.getTime()))).toISOString(),
          to: new Date(Math.max(...times.map((t) => t.getTime()))).toISOString(),
        }
      : null,
    in_app_capture_count: photos.filter((f) => f.in_app_capture).length,
    note: sanitizeNote(note),
  };
  if (ctx.spec_check) summary.spec_check = ctx.spec_check;
  return summary;
}

/** Keys the model may see; tests and the MCP's `read_evidence_summary` assert nothing else leaks. */
export const EVIDENCE_SUMMARY_KEYS = [
  "photo_count",
  "exif_ok_count",
  "gps_within_spec_count",
  "captured_at_range",
  "in_app_capture_count",
  "note",
  "spec_check",
] as const;
