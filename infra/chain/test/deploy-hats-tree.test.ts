import { describe, expect, it } from "vitest";
import { MemoryConfigStore } from "../src/config.js";
import { ENTITY_ROLES, type HatsLike, ROLE_MAX_SUPPLY, deployHatsTree } from "../src/deploy-hats-tree.js";

function fakeHats() {
  const hats = new Map<bigint, { details: string; maxSupply: number; admin: bigint | null }>();
  let next = 1n;
  let creates = 0;
  const api: HatsLike = {
    async mintTopHat({ details }) {
      creates += 1;
      const id = next++ << 224n; // top hats live in the high bits
      hats.set(id, { details, maxSupply: 1, admin: null });
      return id;
    },
    async createHat({ admin, details, maxSupply }) {
      creates += 1;
      const id = admin + next++;
      hats.set(id, { details, maxSupply, admin });
      return id;
    },
    async viewHat(id) {
      const h = hats.get(id);
      return h ? { details: h.details, maxSupply: h.maxSupply } : null;
    },
  };
  return { api, hats, get creates() { return creates; } };
}
const deployer = "0x1111111111111111111111111111111111111111";

describe("deployHatsTree", () => {
  it("creates top + admin + four role hats, then a re-run creates nothing and writes nothing", async () => {
    const f = fakeHats();
    const store = new MemoryConfigStore();
    const r1 = await deployHatsTree({ entitySlug: "boulder-creek", hats: f.api, store, deployer });
    expect(r1.created).toHaveLength(6);
    expect(f.creates).toBe(6);
    expect(store.writes).toBe(6);
    for (const role of ENTITY_ROLES) {
      const id = r1.roles[role]!;
      expect(f.hats.get(id)).toMatchObject({ details: `kami:boulder-creek:${role}`, maxSupply: ROLE_MAX_SUPPLY[role], admin: r1.entityAdminHat });
    }
    expect(f.hats.get(r1.entityAdminHat!)!.admin).toBe(r1.platformTopHat);

    const r2 = await deployHatsTree({ entitySlug: "boulder-creek", hats: f.api, store, deployer });
    expect(r2.created).toHaveLength(0);
    expect(r2.reused).toHaveLength(6);
    expect(f.creates).toBe(6);
    expect(store.writes).toBe(6);
  });

  it("a second entity reuses the platform top hat", async () => {
    const f = fakeHats();
    const store = new MemoryConfigStore();
    const a = await deployHatsTree({ entitySlug: "boulder-creek", hats: f.api, store, deployer });
    const b = await deployHatsTree({ entitySlug: "clear-creek", hats: f.api, store, deployer });
    expect(b.platformTopHat).toBe(a.platformTopHat);
    expect(b.created).toHaveLength(5);
  });

  it("refuses when a stored id points at a hat with other details", async () => {
    const f = fakeHats();
    const store = new MemoryConfigStore();
    await deployHatsTree({ entitySlug: "boulder-creek", hats: f.api, store, deployer });
    const bad = await f.api.createHat({ admin: 1n << 224n, details: "something else", maxSupply: 1 });
    store.data.set("hats.tree.boulder-creek.Guardian", bad.toString());
    await expect(deployHatsTree({ entitySlug: "boulder-creek", hats: f.api, store, deployer })).rejects.toThrow(/expected "kami:boulder-creek:Guardian"/);
  });

  it("dry-run creates nothing", async () => {
    const f = fakeHats();
    const r = await deployHatsTree({ entitySlug: "boulder-creek", hats: f.api, store: new MemoryConfigStore(), deployer, dryRun: true });
    expect(f.creates).toBe(0);
    expect(r.platformTopHat).toBeNull();
  });
});
