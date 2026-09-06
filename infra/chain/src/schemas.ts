/**
 * The five EAS schema strings (architecture §8.1) are owned by
 * `@kami/reputation` so the recompute CLI and the chain scripts can never
 * drift; this module re-exports them and adds the encoder helpers the scripts need.
 */
import type { SchemaEncoder as SchemaEncoderType, SchemaItem } from "@ethereum-attestation-service/eas-sdk";
import { SchemaEncoder } from "./eas-sdk.js";
import {
  EAS_SCHEMAS,
  EAS_SCHEMA_UIDS,
  type EasSchemaName,
  bountyHashOf,
  entityIdOf,
  merkleRootOfUids,
  schemaUidFor,
} from "@kami/reputation";

export { EAS_SCHEMAS, EAS_SCHEMA_UIDS, type EasSchemaName, bountyHashOf, entityIdOf, merkleRootOfUids, schemaUidFor };
export type { SchemaItem };

export const SCHEMA_NAMES = Object.keys(EAS_SCHEMAS) as EasSchemaName[];

/** Registration parameters used for every Kami schema: no resolver, revocable. */
export const SCHEMA_RESOLVER = "0x0000000000000000000000000000000000000000" as const;
export const SCHEMA_REVOCABLE = true as const;

export function schemaEncoderFor(name: EasSchemaName): SchemaEncoderType {
  return new SchemaEncoder(EAS_SCHEMAS[name]);
}

/** ABI-encode attestation data for a schema, in field order, with type checking by the EAS encoder. */
export function encodeSchemaData(name: EasSchemaName, items: SchemaItem[]): `0x${string}` {
  const encoder = schemaEncoderFor(name);
  const expected = encoder.schema.map((f: { name: string }) => f.name);
  const given = items.map((i) => i.name);
  if (expected.join(",") !== given.join(",")) {
    throw new Error(`encodeSchemaData(${name}): fields must be exactly [${expected.join(", ")}] in order; got [${given.join(", ")}]`);
  }
  return encoder.encodeData(items) as `0x${string}`;
}
