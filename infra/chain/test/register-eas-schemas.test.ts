import { describe, expect, it } from "vitest";
import { MemoryConfigStore } from "../src/config.js";
import { type SchemaRecordLike, type SchemaRegistryLike, registerEasSchemas } from "../src/register-eas-schemas.js";
import { EAS_SCHEMAS, SCHEMA_NAMES, schemaUidFor } from "../src/schemas.js";

function fakeRegistry() {
  const records = new Map<string, SchemaRecordLike>();
  let registerCalls = 0;
  const registry: SchemaRegistryLike = {
    async getSchema(uid) {
      return records.get(uid.toLowerCase()) ?? null;
    },
    async register({ schema, resolverAddress, revocable }) {
      registerCalls += 1;
      const uid = schemaUidFor(schema, resolverAddress as `0x${string}`, revocable);
      records.set(uid.toLowerCase(), { uid, schema, resolver: resolverAddress, revocable });
      return uid;
    },
  };
  return { registry, records, get registerCalls() { return registerCalls; } };
}

describe("registerEasSchemas", () => {
  it("registers each of the five schemas once and stores the UIDs; a re-run registers and writes nothing", async () => {
    const f = fakeRegistry();
    const store = new MemoryConfigStore();
    const first = await registerEasSchemas({ registry: f.registry, store });
    expect(first.map((r) => r.action)).toEqual(SCHEMA_NAMES.map(() => "registered"));
    expect(f.registerCalls).toBe(5);
    expect(store.writes).toBe(5);
    for (const name of SCHEMA_NAMES) expect(store.data.get(`eas.schema.${name}`)).toBe(schemaUidFor(EAS_SCHEMAS[name]));

    const second = await registerEasSchemas({ registry: f.registry, store });
    expect(second.every((r) => r.action === "exists" && !r.stored)).toBe(true);
    expect(f.registerCalls).toBe(5);
    expect(store.writes).toBe(5);
  });

  it("dry-run touches neither the registry nor the store", async () => {
    const f = fakeRegistry();
    const store = new MemoryConfigStore();
    const lines: string[] = [];
    const r = await registerEasSchemas({ registry: f.registry, store, dryRun: true, log: (l) => lines.push(l) });
    expect(r.every((x) => x.action === "would-register")).toBe(true);
    expect(f.registerCalls).toBe(0);
    expect(store.writes).toBe(0);
    expect(lines).toHaveLength(5);
  });

  it("refuses when the registry holds a different record under the expected UID", async () => {
    const f = fakeRegistry();
    const uid = schemaUidFor(EAS_SCHEMAS.EntityRegistered);
    f.records.set(uid.toLowerCase(), { uid, schema: "uint8 wrong", resolver: "0x0", revocable: true });
    await expect(registerEasSchemas({ registry: f.registry, store: new MemoryConfigStore() })).rejects.toThrow(/different record/);
  });
});
