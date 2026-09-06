import { type Address, decodeFunctionData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { CHAINS } from "../src/addresses.js";
import { MemoryConfigStore } from "../src/config.js";
import {
  MAX_BOUNTY_USDC6,
  Operator,
  ROLES_ABI,
  USDC_TRANSFER_SELECTOR,
  buildBountyPayerConditions,
  buildBountyPayerSetup,
  enableRoles,
  evaluateConditions,
  predictRolesModuleAddress,
  roleKey,
} from "../src/enable-roles.js";
import { SAFE_ABI } from "../src/safe-tx.js";

const m1 = "0x1000000000000000000000000000000000000001" as Address;
const m2 = "0x1000000000000000000000000000000000000002" as Address;
const stranger = "0x1000000000000000000000000000000000000009" as Address;
const safe = "0x2000000000000000000000000000000000000002" as Address;
const keeper = "0x4000000000000000000000000000000000000004" as Address;
const chain = CHAINS[84532];

describe("bounty-payer condition tree (local model of Roles v2 semantics)", () => {
  const conditions = buildBountyPayerConditions({ allowedRecipients: [m2, m1, m1] });
  const full = 100_000_000n;

  it("lays out BFS: root Matches, Or(to), And(amount), then leaves", () => {
    expect(conditions.slice(0, 3).map((c) => c.operator)).toEqual([Operator.Matches, Operator.Or, Operator.And]);
    expect(conditions.filter((c) => c.parent === 1)).toHaveLength(2); // de-duplicated recipients
    expect(conditions.filter((c) => c.parent === 2).map((c) => c.operator)).toEqual([Operator.LessThan, Operator.WithinAllowance]);
  });
  it("accepts a member at exactly 25 USDC", () => {
    expect(evaluateConditions(conditions, { to: m1, amount: MAX_BOUNTY_USDC6, allowanceRemaining: full })).toEqual({ ok: true });
  });
  it("rejects 25.000001 USDC", () => {
    expect(evaluateConditions(conditions, { to: m1, amount: MAX_BOUNTY_USDC6 + 1n, allowanceRemaining: full })).toMatchObject({ ok: false, reason: /cap/ });
  });
  it("rejects a non-member even at 1 USDC", () => {
    expect(evaluateConditions(conditions, { to: stranger, amount: 1_000_000n, allowanceRemaining: full })).toMatchObject({ ok: false, reason: /not in allowedRecipients/ });
  });
  it("rejects when the 24 h allowance is exhausted", () => {
    expect(evaluateConditions(conditions, { to: m2, amount: 25_000_000n, allowanceRemaining: 0n })).toMatchObject({ ok: false, reason: /allowance/ });
  });
  it("refuses to build an empty recipient set", () => {
    expect(() => buildBountyPayerConditions({ allowedRecipients: [] })).toThrow(/empty/);
  });
});

describe("setup batch", () => {
  it("role key is 'bounty-payer' right-padded to bytes32", () => {
    expect(roleKey()).toBe("0x626f756e74792d7061796572" + "0".repeat(64 - 24));
  });
  it("is enableModule on the Safe, then assignRoles / scopeTarget / scopeFunction / setAllowance on the module", () => {
    const rolesModule = "0x5000000000000000000000000000000000000005" as Address;
    const txs = buildBountyPayerSetup({ safe, rolesModule, usdc: chain.usdc.address, keeper, allowedRecipients: [m1, m2] });
    expect(txs).toHaveLength(5);
    expect(txs[0]!.to).toBe(safe);
    expect(decodeFunctionData({ abi: SAFE_ABI, data: txs[0]!.data })).toEqual({ functionName: "enableModule", args: [rolesModule] });
    expect(txs.slice(1).every((t) => t.to === rolesModule && t.value === "0" && t.operation === 0)).toBe(true);
    const assign = decodeFunctionData({ abi: ROLES_ABI, data: txs[1]!.data });
    expect(assign).toEqual({ functionName: "assignRoles", args: [keeper, [roleKey()], [true]] });
    const scope = decodeFunctionData({ abi: ROLES_ABI, data: txs[3]!.data });
    expect(scope.functionName).toBe("scopeFunction");
    expect(scope.args![1]).toBe(chain.usdc.address);
    expect(scope.args![2]).toBe(USDC_TRANSFER_SELECTOR);
    expect((scope.args![3] as unknown[]).length).toBe(3 + 2 + 2);
    expect(scope.args![4]).toBe(0); // ExecutionOptions.None: no ETH, no delegatecall
    const allowance = decodeFunctionData({ abi: ROLES_ABI, data: txs[4]!.data });
    expect(allowance.args).toEqual([roleKey(), 100_000_000n, 100_000_000n, 100_000_000n, 86_400n, 0n]);
  });
  it("module address prediction is deterministic per entity", () => {
    const p = { factory: chain.moduleProxyFactory.address, mastercopy: chain.rolesModifierMastercopy.address, safe };
    expect(predictRolesModuleAddress({ ...p, entitySlug: "boulder-creek" })).toBe(predictRolesModuleAddress({ ...p, entitySlug: "boulder-creek" }));
    expect(predictRolesModuleAddress({ ...p, entitySlug: "boulder-creek" })).not.toBe(predictRolesModuleAddress({ ...p, entitySlug: "clear-creek" }));
  });
});

describe("enableRoles only proposes", () => {
  it("deploys the module proxy when missing, proposes one batch, and never executes", async () => {
    const proposer = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
    const proposed: unknown[] = [];
    let deployed = 0;
    const store = new MemoryConfigStore();
    const r = await enableRoles({
      chain, entitySlug: "boulder-creek", safe, keeper, allowedRecipients: [m1], proposer, store,
      apiKit: { getNextNonce: async () => 0, proposeTransaction: async (p) => { proposed.push(p); } },
      batch: async (_s, txs) => ({ to: "0x9000000000000000000000000000000000000009", value: "0", data: `0x${txs.length.toString(16).padStart(2, "0")}`, operation: 1 }),
      moduleExists: async () => false,
      deployModule: async () => { deployed += 1; return "0x01"; },
    });
    expect(deployed).toBe(1);
    expect(proposed).toHaveLength(1);
    expect(r.safeTxHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(store.data.get("roles.boulder-creek.module")).toBe(r.rolesModule);
    expect(r.lines.join("\n")).toMatch(/2-of-3/);
  });
});
