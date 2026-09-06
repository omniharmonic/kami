/**
 * Register the five schemas once per chain (T2.2). For each: compute the UID
 * EAS will assign (`keccak256(abi.encodePacked(schema, resolver, revocable))`),
 * ask the registry whether it exists, register only if absent, and record
 * `eas.schema.<Name>` in config. Safe to re-run; a re-run makes no writes.
 */
import { SchemaRegistry } from "./eas-sdk.js";
import type { ChainAddresses } from "./addresses.js";
import { type ConfigStore, writeIfChanged } from "./config.js";
import { EAS_SCHEMAS, SCHEMA_NAMES, SCHEMA_RESOLVER, SCHEMA_REVOCABLE, type EasSchemaName, schemaUidFor } from "./schemas.js";
import type { ViemAccountSigner } from "./signer.js";

export interface SchemaRecordLike {
  uid: string;
  schema: string;
  resolver: string;
  revocable: boolean;
}

/** The two calls the script needs; the real one wraps the EAS SDK, tests inject a fake. */
export interface SchemaRegistryLike {
  getSchema(uid: string): Promise<SchemaRecordLike | null>;
  register(params: { schema: string; resolverAddress: string; revocable: boolean }): Promise<string>;
}

export function schemaRegistryFor(chain: ChainAddresses, signer?: ViemAccountSigner): SchemaRegistryLike {
  const registry = new SchemaRegistry(chain.schemaRegistry.address, signer ? { signer } : undefined);
  return {
    async getSchema(uid) {
      try {
        const r = await registry.getSchema({ uid });
        return { uid: r.uid, schema: r.schema, resolver: r.resolver, revocable: r.revocable };
      } catch (e) {
        if (e instanceof Error && /not found/i.test(e.message)) return null;
        throw e;
      }
    },
    async register(params) {
      const tx = await registry.register(params);
      return tx.wait();
    },
  };
}

export interface RegisterResult {
  name: EasSchemaName;
  uid: `0x${string}`;
  action: "exists" | "registered" | "would-register";
  stored: boolean;
}

export interface RegisterOptions {
  registry: SchemaRegistryLike;
  store: ConfigStore;
  dryRun?: boolean;
  log?: (line: string) => void;
}

export async function registerEasSchemas({ registry, store, dryRun = false, log = () => {} }: RegisterOptions): Promise<RegisterResult[]> {
  const results: RegisterResult[] = [];
  for (const name of SCHEMA_NAMES) {
    const schema = EAS_SCHEMAS[name];
    const uid = schemaUidFor(schema, SCHEMA_RESOLVER, SCHEMA_REVOCABLE);
    const existing = await registry.getSchema(uid);
    let action: RegisterResult["action"];
    if (existing) {
      if (existing.schema !== schema || existing.revocable !== SCHEMA_REVOCABLE) {
        throw new Error(`registry has a different record under ${uid} for ${name}; refusing to continue`);
      }
      action = "exists";
      log(`${name}: exists ${uid}`);
    } else if (dryRun) {
      action = "would-register";
      log(`${name}: would register "${schema}" (resolver ${SCHEMA_RESOLVER}, revocable) → ${uid}`);
    } else {
      const got = await registry.register({ schema, resolverAddress: SCHEMA_RESOLVER, revocable: SCHEMA_REVOCABLE });
      if (got.toLowerCase() !== uid.toLowerCase()) throw new Error(`${name}: registry returned ${got}, expected ${uid}`);
      action = "registered";
      log(`${name}: registered ${uid}`);
    }
    const stored = dryRun ? false : await writeIfChanged(store, `eas.schema.${name}`, uid);
    results.push({ name, uid, action, stored });
  }
  return results;
}
