export { canonicalBytes, canonicalJson } from "./canonical.js";
export {
  EAS_SCHEMAS,
  EAS_SCHEMA_UIDS,
  type EasSchemaName,
  OUTCOME_NAMES,
  Outcome,
  type OutcomeCode,
  bountyHashOf,
  entityIdOf,
  schemaUidFor,
} from "./schemas.js";
export {
  type ComputeOptions,
  Direction,
  EntityScore,
  IsoDateTime,
  OfflineBundle,
  OutcomeAttestation,
  PredictionRecord,
  REPUTATION_FUNCTION_ID,
  ReputationFile,
  Score,
  Uid,
  VerificationTier,
} from "./types.js";
export {
  DECAY_HALF_LIFE_DAYS,
  DEFAULT_PASSPORT_MIN,
  NEW_THRESHOLD_N,
  OUTPUT_DECIMALS,
  STAKE_SCALE_USD,
  TIER4_FOLLOWED_UP_WEIGHT,
  TIER_WEIGHT,
  WILSON_Z,
  buildNightlyFile,
  computeEntityScores,
  computeReputation,
  decay,
  merkleRootOfUids,
  renderReputationFile,
  round,
  stakeWeight,
  successOf,
  weightOf,
  wilsonLowerBound,
  writeNightlyFile,
} from "./v1.js";
export {
  DEFAULT_EAS_GRAPHQL_BASE,
  type EasAttestationRow,
  type FetchLike,
  decodeFields,
  fetchEasRows,
  joinOutcomeRows,
  loadAttestationsFromEas,
} from "./eas.js";
// The CLI (`./cli.js`, `kami-reputation-recompute`) is deliberately NOT
// re-exported here. It reads files and queries EAS; a dynamic `readFile` in
// this import graph makes Next trace the whole repository into the web app's
// serverless bundle. Import `@kami/reputation/cli` when you want the tool.
export {
  type JsonDiff,
  type RecomputeAux,
  type RecomputeResult,
  diffJson,
  formatDiff,
  recomputeFromInputs,
} from "./recompute.js";
