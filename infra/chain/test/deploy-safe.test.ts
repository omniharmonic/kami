import { type Address, keccak256, stringToBytes } from "viem";
import { describe, expect, it } from "vitest";
import { CHAINS } from "../src/addresses.js";
import { MemoryConfigStore } from "../src/config.js";
import { type SafeInit, type SafeLike, assertOwnersValid, deploySafe, predictSafeAddress, predictedSafeConfig, safeSaltNonce } from "../src/deploy-safe.js";
import { privateKeyToAccount } from "viem/accounts";

const creator = "0x1000000000000000000000000000000000000001" as Address;
const gA = "0x1000000000000000000000000000000000000002" as Address;
const gB = "0x1000000000000000000000000000000000000003" as Address;
const deployer = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const chain = CHAINS[84532];

/** A fake Protocol Kit whose "address" is a hash of the exact config it received. */
function fakeInit(deployed = false): { init: SafeInit; seen: unknown[] } {
  const seen: unknown[] = [];
  const init: SafeInit = async (cfg) => {
    seen.push(cfg);
    const addr = `0x${keccak256(stringToBytes(JSON.stringify(cfg.predictedSafe))).slice(26)}` as Address;
    const safe: SafeLike = {
      getAddress: async () => addr,
      isSafeDeployed: async () => deployed,
      createSafeDeploymentTransaction: async () => ({ to: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67", value: "0", data: "0x1234" }),
      getOwners: async () => cfg.predictedSafe.safeAccountConfig.owners,
      getThreshold: async () => cfg.predictedSafe.safeAccountConfig.threshold,
    };
    return safe;
  };
  return { init, seen };
}

describe("Safe salt and prediction", () => {
  it("salt nonce = keccak256('kami:' + slug), deterministic, distinct per slug", () => {
    expect(safeSaltNonce("boulder-creek")).toBe(BigInt(keccak256(stringToBytes("kami:boulder-creek"))).toString());
    expect(safeSaltNonce("boulder-creek")).toBe(safeSaltNonce("boulder-creek"));
    expect(safeSaltNonce("boulder-creek")).not.toBe(safeSaltNonce("clear-creek"));
    expect(() => safeSaltNonce("Bad Slug")).toThrow();
  });

  it("predictedSafeConfig pins version 1.4.1 canonical with the slug salt", () => {
    const c = predictedSafeConfig({ owners: [creator, gA, gB], entitySlug: "boulder-creek" });
    expect(c.safeDeploymentConfig).toEqual({ saltNonce: safeSaltNonce("boulder-creek"), safeVersion: "1.4.1", deploymentType: "canonical" });
    expect(c.safeAccountConfig.threshold).toBe(2);
  });

  it("predictSafeAddress is deterministic for the same slug and owners (mocked Protocol Kit)", async () => {
    const { init } = fakeInit();
    const a = await predictSafeAddress({ chain, entitySlug: "boulder-creek", owners: [creator, gA, gB], init });
    const b = await predictSafeAddress({ chain, entitySlug: "boulder-creek", owners: [creator, gA, gB], init });
    const c = await predictSafeAddress({ chain, entitySlug: "clear-creek", owners: [creator, gA, gB], init });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("owner assertions", () => {
  it("throws when the deployer is an owner", () => {
    expect(() => assertOwnersValid({ owners: [creator, gA, deployer.address], deployer: deployer.address })).toThrow(/must not be a Safe owner/);
  });
  it("throws on duplicates, wrong count, wrong threshold", () => {
    expect(() => assertOwnersValid({ owners: [creator, creator, gB], deployer: deployer.address })).toThrow(/distinct/);
    expect(() => assertOwnersValid({ owners: [creator, gA], deployer: deployer.address })).toThrow(/exactly/);
    expect(() => assertOwnersValid({ owners: [creator, gA, gB], threshold: 1, deployer: deployer.address })).toThrow(/threshold/);
  });
  it("accepts creator + two guardians at 2", () => {
    expect(() => assertOwnersValid({ owners: [creator, gA, gB], deployer: deployer.address })).not.toThrow();
  });
});

describe("deploySafe", () => {
  it("refuses before touching the chain when the deployer is an owner", async () => {
    const { init, seen } = fakeInit();
    await expect(deploySafe({ chain, entitySlug: "boulder-creek", owners: [creator, gA, deployer.address], deployer, store: new MemoryConfigStore(), init })).rejects.toThrow(/must not be a Safe owner/);
    expect(seen).toHaveLength(0);
  });

  it("dry-run predicts and sends nothing", async () => {
    const { init } = fakeInit();
    let sent = 0;
    const r = await deploySafe({ chain, entitySlug: "boulder-creek", owners: [creator, gA, gB], deployer, store: new MemoryConfigStore(), init, dryRun: true, send: async () => { sent += 1; return "0x01"; } });
    expect(r.action).toBe("would-deploy");
    expect(sent).toBe(0);
  });

  it("deploys once, stores the address, and a re-run is a no-op", async () => {
    let deployed = false;
    const base = fakeInit();
    const init: SafeInit = async (cfg) => {
      const s = await base.init(cfg);
      return { ...s, isSafeDeployed: async () => deployed };
    };
    const connect = (cfg: { provider: string; safeAddress: string }) => init({ provider: cfg.provider, predictedSafe: predictedSafeConfig({ owners: [creator, gA, gB], entitySlug: "boulder-creek" }) });
    const store = new MemoryConfigStore();
    let sent = 0;
    const send = async () => { sent += 1; deployed = true; return "0xdead" as const; };
    const r1 = await deploySafe({ chain, entitySlug: "boulder-creek", owners: [creator, gA, gB], deployer, store, init, connect, send });
    expect(r1.action).toBe("deployed");
    expect(sent).toBe(1);
    expect(store.data.get("safe.boulder-creek.address")).toBe(r1.address);
    const r2 = await deploySafe({ chain, entitySlug: "boulder-creek", owners: [creator, gA, gB], deployer, store, init, connect, send });
    expect(r2.action).toBe("exists");
    expect(sent).toBe(1);
    expect(store.writes).toBe(1);
  });
});
