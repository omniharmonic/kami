import { evidenceSpecCopy, tierLabel } from "@/copy";
import type { EvidenceSpec } from "@/lib/evidence/spec";

/** One line describing what evidence a bounty requires, so a claimant knows before starting. */
export function evidenceSpecLine(spec: EvidenceSpec, capUsdc?: number): string {
  const parts: string[] = [];
  if (spec.min_photos > 0) parts.push(evidenceSpecCopy.minPhotos(spec.min_photos));
  if (spec.exif_required) parts.push(evidenceSpecCopy.exif);
  if (spec.gps_within_m !== null) parts.push(evidenceSpecCopy.gps(spec.gps_within_m));
  parts.push(spec.capture === "in_app" ? evidenceSpecCopy.inApp : evidenceSpecCopy.anyCapture);
  if (capUsdc !== undefined && capUsdc > spec.second_attestation_above_usdc) parts.push(evidenceSpecCopy.secondAbove(spec.second_attestation_above_usdc));
  return parts.join(" · ");
}

export function EvidenceSpecSummary({ spec, tier, capUsdc }: { spec: EvidenceSpec; tier?: number; capUsdc?: number }) {
  return (
    <p className="faint" style={{ margin: "0.2rem 0 0", fontSize: "0.85rem" }}>
      {tier !== undefined && <>{tierLabel[tier] ?? `tier ${tier}`} · </>}
      {evidenceSpecLine(spec, capUsdc)}
    </p>
  );
}
