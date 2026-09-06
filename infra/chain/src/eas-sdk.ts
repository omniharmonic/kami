/**
 * Runtime import of the EAS SDK through its CommonJS build.
 *
 * eas-sdk 2.10.0's ESM build does `import { isEqual } from 'lodash'`, which
 * native Node ESM rejects (lodash is CJS and its named exports are not
 * statically detectable). Vitest interops it; `tsx`/`node` do not. Types still
 * come from the package's declarations via `import type`.
 */
import { createRequire } from "node:module";
import type * as EasSdk from "@ethereum-attestation-service/eas-sdk";

const require = createRequire(import.meta.url);
const sdk = require("@ethereum-attestation-service/eas-sdk") as typeof EasSdk;

export const { EAS, SchemaRegistry, SchemaEncoder, Offchain, OffchainAttestationVersion, OFFCHAIN_ATTESTATION_TYPES } = sdk;
