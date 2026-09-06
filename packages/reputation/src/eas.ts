/**
 * EAS GraphQL adapter — turns the indexer's view of `ProposalOutcome` (+ the
 * `BountyPosted` each one references) into `OutcomeAttestation` records.
 *
 * *verify* (docs/verify.md #9): the Base endpoint (`https://base.easscan.org/graphql`)
 * and the `decodedDataJson` shape below are taken from the public easscan
 * indexer as of writing; nothing here runs in tests against the network — the
 * decode/join is tested with a fake `fetch`.
 */
import { EAS_SCHEMA_UIDS, entityIdOf } from "./schemas.js";
import { OutcomeAttestation, type Uid } from "./types.js";

export const DEFAULT_EAS_GRAPHQL_BASE = "https://base.easscan.org/graphql"; // *verify*

/** One row as easscan returns it (subset). */
export interface EasAttestationRow {
  id: string;
  schemaId: string;
  attester: string;
  recipient: string;
  refUID: string;
  revoked: boolean;
  /** Unix seconds. */
  time: number | string;
  /** JSON-encoded array of `{name, type, value: {name, type, value}}`. */
  decodedDataJson: string;
}

type DecodedValue = string | number | boolean | { type: "BigNumber"; hex: string };
interface DecodedField {
  name: string;
  type: string;
  value: { name: string; type: string; value: DecodedValue };
}

export function decodeFields(decodedDataJson: string): Map<string, DecodedValue> {
  const fields = JSON.parse(decodedDataJson) as DecodedField[];
  return new Map(fields.map((f) => [f.name, f.value.value]));
}

function asBigInt(v: DecodedValue | undefined, name: string): bigint {
  if (typeof v === "number") return BigInt(v);
  if (typeof v === "string") return BigInt(v);
  if (typeof v === "object" && v !== null && "hex" in v) return BigInt(v.hex);
  throw new TypeError(`EAS: cannot read ${name} as an integer`);
}
function asHex(v: DecodedValue | undefined, name: string): string {
  if (typeof v === "string" && /^0x[0-9a-fA-F]+$/.test(v)) return v.toLowerCase();
  throw new TypeError(`EAS: cannot read ${name} as hex`);
}

const ATTESTATIONS_QUERY = `query Kami($ids: [String!]) {
  attestations(where: { id: { in: $ids } }) {
    id schemaId attester recipient refUID revoked time decodedDataJson
  }
}`;

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export async function fetchEasRows(
  ids: readonly string[],
  endpoint: string,
  fetchImpl: FetchLike = fetch,
): Promise<EasAttestationRow[]> {
  const out: EasAttestationRow[] = [];
  const CHUNK = 100;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const res = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "kami-reputation-recompute" },
      body: JSON.stringify({ query: ATTESTATIONS_QUERY, variables: { ids: ids.slice(i, i + CHUNK) } }),
    });
    if (!res.ok) throw new Error(`EAS GraphQL ${endpoint} → HTTP ${res.status}`);
    const body = (await res.json()) as { data?: { attestations?: EasAttestationRow[] }; errors?: unknown };
    if (body.errors) throw new Error(`EAS GraphQL errors: ${JSON.stringify(body.errors)}`);
    out.push(...(body.data?.attestations ?? []));
  }
  return out;
}

export interface JoinOptions {
  /** Known entity ids (`entity/<slug>`), used to map bytes32 `entityId` back to a slug. */
  knownEntities?: readonly string[];
}

/**
 * Join `ProposalOutcome` rows with their `BountyPosted` (refUID) rows.
 *
 * - `subject` = the outcome's `recipient` (the claimant), lowercased.
 * - `verification_tier`, `usd_at_stake` come from the referenced BountyPosted
 *   (`verificationTier`, `capUSDC` / 1e6).
 * - `entity_id` is mapped back to a slug via `entityIdOf(known)`; unknown
 *   hashes are kept as the bytes32 hex.
 * - Tier-4 follow-up: several outcomes sharing one BountyPosted are ordered by
 *   (time, uid); every outcome after the first gets `follow_up_of` = the first
 *   one's uid. *verify* against the tier-4 deposit/balance flow once T2.9 lands.
 */
export function joinOutcomeRows(
  rows: readonly EasAttestationRow[],
  opts: JoinOptions = {},
): OutcomeAttestation[] {
  const outcomeSchema = EAS_SCHEMA_UIDS.ProposalOutcome.toLowerCase();
  const postedSchema = EAS_SCHEMA_UIDS.BountyPosted.toLowerCase();
  const byId = new Map(rows.map((r) => [r.id.toLowerCase(), r]));
  const slugByHash = new Map<string, string>();
  for (const e of opts.knownEntities ?? []) slugByHash.set(entityIdOf(e).toLowerCase(), e);

  const outcomes = rows.filter((r) => r.schemaId.toLowerCase() === outcomeSchema);
  const result: OutcomeAttestation[] = [];
  const byRef = new Map<string, OutcomeAttestation[]>();

  for (const r of outcomes) {
    const f = decodeFields(r.decodedDataJson);
    const ref = byId.get(r.refUID.toLowerCase());
    if (!ref || ref.schemaId.toLowerCase() !== postedSchema) {
      throw new Error(`EAS: outcome ${r.id} has no BountyPosted at refUID ${r.refUID}`);
    }
    const posted = decodeFields(ref.decodedDataJson);
    const entityHash = asHex(f.get("entityId"), "entityId");
    const tier = Number(asBigInt(posted.get("verificationTier"), "verificationTier"));
    const capUsdc = asBigInt(posted.get("capUSDC"), "capUSDC");
    const timeS = typeof r.time === "string" ? Number(r.time) : r.time;
    const a = OutcomeAttestation.parse({
      uid: r.id,
      entity_id: slugByHash.get(entityHash) ?? entityHash,
      proposal_hash: asHex(f.get("proposalHash"), "proposalHash"),
      subject: r.recipient.toLowerCase(),
      outcome: Number(asBigInt(f.get("outcome"), "outcome")),
      verification_tier: tier,
      usd_at_stake: Number(capUsdc) / 1e6,
      attested_at: new Date(timeS * 1000).toISOString(),
      revoked: r.revoked,
    });
    result.push(a);
    const list = byRef.get(r.refUID.toLowerCase()) ?? [];
    list.push(a);
    byRef.set(r.refUID.toLowerCase(), list);
  }

  for (const list of byRef.values()) {
    if (list.length < 2) continue;
    list.sort((x, y) =>
      x.attested_at < y.attested_at ? -1 : x.attested_at > y.attested_at ? 1 : x.uid < y.uid ? -1 : 1,
    );
    const first = list[0]!;
    for (const later of list.slice(1)) {
      if (later.verification_tier === 4) later.follow_up_of = first.uid as Uid;
    }
  }
  return result.sort((x, y) => (x.uid < y.uid ? -1 : x.uid > y.uid ? 1 : 0));
}

/** Convenience: fetch + join the UIDs listed in a published file. */
export async function loadAttestationsFromEas(
  uids: readonly string[],
  endpoint: string,
  opts: JoinOptions & { fetchImpl?: FetchLike } = {},
): Promise<OutcomeAttestation[]> {
  const outcomeRows = await fetchEasRows(uids, endpoint, opts.fetchImpl);
  const refIds = [...new Set(outcomeRows.map((r) => r.refUID.toLowerCase()))].filter(
    (id) => !/^0x0+$/.test(id),
  );
  const have = new Set(outcomeRows.map((r) => r.id.toLowerCase()));
  const missing = refIds.filter((id) => !have.has(id));
  const refRows = missing.length ? await fetchEasRows(missing, endpoint, opts.fetchImpl) : [];
  return joinOutcomeRows([...outcomeRows, ...refRows], opts);
}
