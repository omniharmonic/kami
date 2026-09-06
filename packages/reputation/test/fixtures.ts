import type { OutcomeAttestation, PredictionRecord } from "../src/types.js";

export const NOW = "2026-09-06T00:00:00.000Z";
export const NOW_MS = Date.parse(NOW);

export function uid(n: number): `0x${string}` {
  return `0x${n.toString(16).padStart(64, "0")}`;
}

let seq = 1;
export function resetSeq(): void {
  seq = 1;
}

/** Attestation builder: defaults to a succeeded tier-2 $40 claim aged 0 days. */
export function att(over: Partial<OutcomeAttestation> = {}): OutcomeAttestation {
  const n = seq++;
  return {
    uid: uid(n),
    entity_id: "entity/boulder-creek",
    proposal_hash: uid(1000 + n),
    subject: "alice",
    outcome: 0,
    verification_tier: 2,
    usd_at_stake: 40,
    attested_at: NOW,
    revoked: false,
    ...over,
  };
}

export function agedIso(days: number): string {
  return new Date(NOW_MS - days * 86_400_000).toISOString();
}

export function prediction(over: Partial<PredictionRecord> = {}): PredictionRecord {
  return {
    entity: "entity/boulder-creek",
    place_id: "stream_reach/boulder-creek-orodell",
    property: "turbidity",
    direction: "down",
    window_end: agedIso(1),
    observed_direction: "down",
    ...over,
  };
}
