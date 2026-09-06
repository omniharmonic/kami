/**
 * The §7.6 `evidence_spec` and the check of a submission's files against it
 * (T2.8). Pure: the files are already-parsed facts, the anchor comes from the
 * caller.
 */
import { z } from "zod";
import { withinMetres, type LatLon } from "./gps";

export const evidenceSpecSchema = z.object({
  min_photos: z.number().int().min(0).max(30).default(0),
  exif_required: z.boolean().default(false),
  gps_within_m: z.number().positive().max(100_000).nullable().default(null),
  capture: z.enum(["in_app", "any"]).default("any"),
  second_attestation_above_usdc: z.number().nonnegative().default(100),
});
export type EvidenceSpec = z.infer<typeof evidenceSpecSchema>;

export const DEFAULT_EVIDENCE_SPEC: EvidenceSpec = evidenceSpecSchema.parse({});

/** What the platform knows about one uploaded file after `finalize`. Never free text. */
export type EvidenceFileFacts = {
  sha256: string;
  mime: string | null;
  bytes: number | null;
  /** EXIF DateTimeOriginal (or CreateDate), null when absent */
  captured_at: Date | null;
  gps: LatLon | null;
  /** true when any EXIF block was present at all */
  exif_present: boolean;
  in_app_capture: boolean;
};

export type SpecCheck = { ok: boolean; failures: string[] };

export function checkAgainstSpec(files: EvidenceFileFacts[], spec: EvidenceSpec, ctx: { anchor?: LatLon | null } = {}): SpecCheck {
  const failures: string[] = [];
  const photos = files.filter((f) => !f.mime || f.mime.startsWith("image/"));
  if (photos.length < spec.min_photos) failures.push(`min_photos: ${photos.length} < ${spec.min_photos}`);
  if (spec.exif_required) {
    const missing = photos.filter((f) => !f.exif_present || !f.captured_at).length;
    if (missing > 0) failures.push(`exif_required: ${missing} file${missing === 1 ? "" : "s"} without EXIF capture time`);
  }
  if (spec.gps_within_m !== null) {
    if (!ctx.anchor) {
      failures.push("gps_within_m: anchor unknown — distance not checked");
    } else {
      let outside = 0;
      let noGps = 0;
      for (const f of photos) {
        const w = withinMetres(f.gps, ctx.anchor, spec.gps_within_m);
        if (w === null) noGps++;
        else if (!w) outside++;
      }
      if (noGps > 0) failures.push(`gps_within_m: ${noGps} file${noGps === 1 ? "" : "s"} without GPS`);
      if (outside > 0) failures.push(`gps_within_m: ${outside} file${outside === 1 ? "" : "s"} more than ${spec.gps_within_m} m from the place`);
    }
  }
  if (spec.capture === "in_app") {
    const outside = photos.filter((f) => !f.in_app_capture).length;
    if (outside > 0) failures.push(`capture: ${outside} file${outside === 1 ? "" : "s"} not captured in the app`);
  }
  return { ok: failures.length === 0, failures };
}

export function parseEvidenceSpec(raw: unknown): EvidenceSpec {
  const r = evidenceSpecSchema.safeParse(raw ?? {});
  return r.success ? r.data : DEFAULT_EVIDENCE_SPEC;
}
