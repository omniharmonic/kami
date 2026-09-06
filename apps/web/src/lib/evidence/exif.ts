/**
 * EXIF parsing with `exifr`. Missing means null, never zero. Only the fields
 * the spec check needs are read; camera make/model are kept for the
 * `evidence_files.exif` column and never reach the model.
 */
import type { LatLon } from "./gps";

export type ParsedExif = {
  captured_at: Date | null;
  gps: LatLon | null;
  make: string | null;
  model: string | null;
  present: boolean;
};

export const EMPTY_EXIF: ParsedExif = { captured_at: null, gps: null, make: null, model: null, present: false };

type ExifrLike = { parse: (input: Uint8Array | ArrayBuffer | Buffer, opts?: unknown) => Promise<Record<string, unknown> | undefined> };

let exifrModule: Promise<ExifrLike> | null = null;
async function loadExifr(): Promise<ExifrLike> {
  if (!exifrModule) {
    exifrModule = import("exifr").then((m) => (("default" in m && m.default ? m.default : m) as unknown as ExifrLike));
  }
  return exifrModule;
}

function toDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "string") {
    // EXIF "YYYY:MM:DD HH:MM:SS"
    const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(v);
    if (m) {
      const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!));
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function toNum(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Normalise an exifr output object (also used by tests with a synthetic object). */
export function exifFromParsed(raw: Record<string, unknown> | null | undefined): ParsedExif {
  if (!raw || Object.keys(raw).length === 0) return EMPTY_EXIF;
  const captured_at = toDate(raw.DateTimeOriginal) ?? toDate(raw.CreateDate) ?? toDate(raw.ModifyDate) ?? null;
  const lat = toNum(raw.latitude) ?? toNum(raw.GPSLatitude);
  const lon = toNum(raw.longitude) ?? toNum(raw.GPSLongitude);
  const gps = lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0) ? { lat, lon } : null;
  return {
    captured_at,
    gps,
    make: typeof raw.Make === "string" ? raw.Make.trim() || null : null,
    model: typeof raw.Model === "string" ? raw.Model.trim() || null : null,
    present: true,
  };
}

export async function parseExif(bytes: Uint8Array | ArrayBuffer | Buffer): Promise<ParsedExif> {
  try {
    const exifr = await loadExifr();
    const raw = await exifr.parse(bytes, {
      pick: ["DateTimeOriginal", "CreateDate", "ModifyDate", "Make", "Model", "GPSLatitude", "GPSLongitude", "GPSLatitudeRef", "GPSLongitudeRef"],
      gps: true,
      tiff: true,
      exif: true,
      ifd0: true,
      xmp: false,
      icc: false,
      iptc: false,
      jfif: false,
      ihdr: false,
      mergeOutput: true,
      reviveValues: true,
      translateValues: true,
    });
    return exifFromParsed(raw ?? null);
  } catch {
    return EMPTY_EXIF;
  }
}
