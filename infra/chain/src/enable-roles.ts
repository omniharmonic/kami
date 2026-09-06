/**
 * Zodiac Roles Modifier v2 allowance (architecture §7.5, T3.5 — the *allowance
 * phase*, phase 3). Role `bounty-payer`:
 *
 *   member   = the keeper key held by the signing service (never the proposer key)
 *   target   = USDC, function `transfer(address,uint256)`, call-only
 *   to       ∈ allowedRecipients (an Or over EqualTo leaves; refreshed daily by the
 *              platform from Verified Contributor hat wearers — never by the agent)
 *   amount   ≤ 25 USDC (LessThan 25_000_001 on the 6-decimal integer)
 *   spend    ≤ 100 USDC per 24 h (`WithinAllowance` on allowance key "bounty-payer")
 *
 * Everything else stays 2-of-3. This script never sends the enabling
 * transaction: it builds the Safe transaction batch (enableModule + role
 * configuration, all owner-only calls on the module whose owner is the Safe),
 * PROPOSES it through the Transaction Service, prints what it does, and stops.
 * Two guardians sign in the platform's /guardian queue.
 *
 * *verify* (docs/verify.md #8): Base / Base Sepolia deployment addresses of the
 * Roles v2 mastercopy and the ModuleProxyFactory (see addresses.ts), and the
 * v2 condition-tree encoding below against the Roles SDK before mainnet — the
 * `evaluateConditions` model in this file is a local re-statement of the
 * documented semantics for tests, not the contract.
 */
import {
  type Address,
  type Hex,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  getContractAddress,
  keccak256,
  encodePacked,
  padHex,
  parseAbi,
  stringToHex,
  toFunctionSelector,
} from "viem";
import type { ChainAddresses } from "./addresses.js";
import { type ConfigStore, writeIfChanged } from "./config.js";
import { type ApiKitLike, type MetaTransactionData, OperationType, SAFE_ABI, proposeTransaction } from "./safe-tx.js";
import type { ChainAccount } from "./signer.js";

// ---- Roles v2 types (Types.sol) ---------------------------------------------

export enum ParameterType {
  None = 0,
  Static = 1,
  Dynamic = 2,
  Tuple = 3,
  Array = 4,
  Calldata = 5,
  AbiEncoded = 6,
}

export enum Operator {
  Pass = 0,
  And = 1,
  Or = 2,
  Nor = 3,
  Matches = 5,
  ArraySome = 6,
  ArrayEvery = 7,
  ArraySubset = 8,
  EqualToAvatar = 15,
  EqualTo = 16,
  GreaterThan = 17,
  LessThan = 18,
  SignedIntGreaterThan = 19,
  SignedIntLessThan = 20,
  Bitmask = 21,
  Custom = 22,
  WithinAllowance = 28,
  EtherWithinAllowance = 29,
  CallWithinAllowance = 30,
}

export enum ExecutionOptions {
  None = 0,
  Send = 1,
  DelegateCall = 2,
  Both = 3,
}

export interface ConditionFlat {
  parent: number;
  paramType: ParameterType;
  operator: Operator;
  compValue: Hex;
}

export const ROLES_ABI = parseAbi([
  "function setUp(bytes initParams)",
  "function assignRoles(address module, bytes32[] roleKeys, bool[] memberOf)",
  "function scopeTarget(bytes32 roleKey, address targetAddress)",
  "function scopeFunction(bytes32 roleKey, address targetAddress, bytes4 selector, (uint8 parent, uint8 paramType, uint8 operator, bytes compValue)[] conditions, uint8 options)",
  "function setAllowance(bytes32 key, uint128 balance, uint128 maxRefill, uint128 refill, uint64 period, uint64 timestamp)",
  "function execTransactionWithRole(address to, uint256 value, bytes data, uint8 operation, bytes32 roleKey, bool shouldRevert) returns (bool)",
]);

export const MODULE_PROXY_FACTORY_ABI = parseAbi([
  "function deployModule(address masterCopy, bytes initializer, uint256 saltNonce) returns (address proxy)",
]);

export const BOUNTY_PAYER_ROLE = "bounty-payer";
export const MAX_BOUNTY_USDC6 = 25_000_000n;
export const ALLOWANCE_PER_PERIOD_USDC6 = 100_000_000n;
export const ALLOWANCE_PERIOD_S = 86_400;
export const USDC_TRANSFER_SELECTOR = toFunctionSelector("transfer(address,uint256)");

/** bytes32 role/allowance key: the ASCII label, right-padded (how the Roles app encodes keys). */
export function roleKey(label: string = BOUNTY_PAYER_ROLE): Hex {
  if (label.length === 0 || label.length > 32) throw new Error("roleKey: label must be 1–32 ASCII chars");
  return padHex(stringToHex(label), { size: 32, dir: "right" });
}

function addressCompValue(a: Address): Hex {
  return encodeAbiParameters([{ type: "address" }], [getAddress(a)]);
}
function uintCompValue(n: bigint): Hex {
  return encodeAbiParameters([{ type: "uint256" }], [n]);
}

/**
 * Condition tree for `transfer(address to, uint256 amount)`, flattened in BFS
 * order with `parent` indices (the layout `scopeFunction` expects):
 *
 *   0  Calldata · Matches
 *   1  ├─ (to)     None · Or            → children: Static · EqualTo <recipient> …
 *   2  └─ (amount) None · And           → children: Static · LessThan max+1, Static · WithinAllowance key
 */
export function buildBountyPayerConditions({
  allowedRecipients,
  maxAmountUsdc6 = MAX_BOUNTY_USDC6,
  allowanceKey = roleKey(BOUNTY_PAYER_ROLE),
}: {
  allowedRecipients: readonly Address[];
  maxAmountUsdc6?: bigint;
  allowanceKey?: Hex;
}): ConditionFlat[] {
  const recipients = [...new Set(allowedRecipients.map((a) => getAddress(a)))].sort();
  if (recipients.length === 0) throw new Error("buildBountyPayerConditions: allowedRecipients is empty — an empty Or admits nobody; refuse rather than scope");
  if (maxAmountUsdc6 <= 0n) throw new Error("maxAmountUsdc6 must be positive");
  const conditions: ConditionFlat[] = [
    { parent: 0, paramType: ParameterType.Calldata, operator: Operator.Matches, compValue: "0x" },
    { parent: 0, paramType: ParameterType.None, operator: Operator.Or, compValue: "0x" },
    { parent: 0, paramType: ParameterType.None, operator: Operator.And, compValue: "0x" },
  ];
  for (const r of recipients) conditions.push({ parent: 1, paramType: ParameterType.Static, operator: Operator.EqualTo, compValue: addressCompValue(r) });
  conditions.push({ parent: 2, paramType: ParameterType.Static, operator: Operator.LessThan, compValue: uintCompValue(maxAmountUsdc6 + 1n) });
  conditions.push({ parent: 2, paramType: ParameterType.Static, operator: Operator.WithinAllowance, compValue: allowanceKey });
  return conditions;
}

/**
 * Local model of how Roles v2 evaluates the tree above for a
 * `transfer(to, amount)` call. Used by tests to check the tree we build says
 * what §7.5 says; it is not the contract.
 */
export function evaluateConditions(
  conditions: readonly ConditionFlat[],
  call: { to: Address; amount: bigint; allowanceRemaining: bigint },
): { ok: boolean; reason?: string } {
  const children = (i: number) => conditions.map((c, j) => [c, j] as const).filter(([c, j]) => j !== 0 && c.parent === i).map(([, j]) => j);
  // parameter index of a node = its position among the root's children (Calldata Matches children map to params in order)
  const params: readonly [Address, bigint] = [getAddress(call.to), call.amount];
  const param = (idx: number): Address | bigint => {
    const v = params[idx];
    if (v === undefined) throw new Error(`evaluateConditions: no parameter ${idx}`);
    return v;
  };
  const evalNode = (i: number, paramIdx: number): boolean => {
    const c = conditions[i]!;
    switch (c.operator) {
      case Operator.Matches:
        return children(i).every((j, k) => evalNode(j, k));
      case Operator.And:
        return children(i).every((j) => evalNode(j, paramIdx));
      case Operator.Or:
        return children(i).some((j) => evalNode(j, paramIdx));
      case Operator.Nor:
        return !children(i).some((j) => evalNode(j, paramIdx));
      case Operator.Pass:
        return true;
      case Operator.EqualTo: {
        const v = param(paramIdx);
        return typeof v === "string" ? c.compValue.toLowerCase() === addressCompValue(v).toLowerCase() : uintCompValue(v).toLowerCase() === c.compValue.toLowerCase();
      }
      case Operator.LessThan: {
        const v = param(paramIdx);
        return typeof v === "bigint" && v < BigInt(c.compValue);
      }
      case Operator.GreaterThan: {
        const v = param(paramIdx);
        return typeof v === "bigint" && v > BigInt(c.compValue);
      }
      case Operator.WithinAllowance: {
        const v = param(paramIdx);
        return typeof v === "bigint" && v <= call.allowanceRemaining;
      }
      default:
        throw new Error(`evaluateConditions: operator ${c.operator} not modelled`);
    }
  };
  const ok = evalNode(0, 0);
  if (ok) return { ok };
  if (!conditions.some((c) => c.operator === Operator.EqualTo && c.compValue.toLowerCase() === addressCompValue(call.to).toLowerCase())) return { ok, reason: "recipient not in allowedRecipients" };
  if (call.amount > call.allowanceRemaining) return { ok, reason: "exceeds 24 h allowance" };
  return { ok, reason: "amount above per-transfer cap" };
}

// ---- module deployment (CREATE2 through the Zodiac ModuleProxyFactory) -------

export function rolesInitializer(safe: Address): Hex {
  const initParams = encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "address" }],
    [getAddress(safe), getAddress(safe), getAddress(safe)], // owner, avatar, target
  );
  return encodeFunctionData({ abi: ROLES_ABI, functionName: "setUp", args: [initParams] });
}

export function rolesSaltNonce(entitySlug: string): bigint {
  return BigInt(keccak256(stringToHex(`kami:roles:${entitySlug}`)));
}

/** ModuleProxyFactory address derivation: minimal proxy of the mastercopy, salt = keccak256(keccak256(initializer) ‖ saltNonce). *verify* */
export function predictRolesModuleAddress({ factory, mastercopy, safe, entitySlug }: { factory: Address; mastercopy: Address; safe: Address; entitySlug: string }): Address {
  const initializer = rolesInitializer(safe);
  const salt = keccak256(encodePacked(["bytes32", "uint256"], [keccak256(initializer), rolesSaltNonce(entitySlug)]));
  const bytecode = `0x602d8060093d393df3363d3d373d3d3d363d73${getAddress(mastercopy).slice(2).toLowerCase()}5af43d82803e903d91602b57fd5bf3` as Hex;
  return getContractAddress({ opcode: "CREATE2", from: getAddress(factory), salt, bytecode });
}

export function deployRolesModuleTx({ factory, mastercopy, safe, entitySlug }: { factory: Address; mastercopy: Address; safe: Address; entitySlug: string }): { to: Address; data: Hex } {
  return {
    to: getAddress(factory),
    data: encodeFunctionData({ abi: MODULE_PROXY_FACTORY_ABI, functionName: "deployModule", args: [getAddress(mastercopy), rolesInitializer(safe), rolesSaltNonce(entitySlug)] }),
  };
}

// ---- the Safe transaction batch ---------------------------------------------

export interface BountyPayerSetup {
  safe: Address;
  rolesModule: Address;
  usdc: Address;
  keeper: Address;
  allowedRecipients: readonly Address[];
  maxAmountUsdc6?: bigint;
  allowancePerPeriodUsdc6?: bigint;
  periodSeconds?: number;
}

export function buildScopeFunctionTx({ rolesModule, usdc, allowedRecipients, maxAmountUsdc6 }: Pick<BountyPayerSetup, "rolesModule" | "usdc" | "allowedRecipients" | "maxAmountUsdc6">): MetaTransactionData {
  const key = roleKey(BOUNTY_PAYER_ROLE);
  const conditions = buildBountyPayerConditions({ allowedRecipients, maxAmountUsdc6, allowanceKey: key });
  return {
    to: getAddress(rolesModule),
    value: "0",
    operation: OperationType.Call,
    data: encodeFunctionData({
      abi: ROLES_ABI,
      functionName: "scopeFunction",
      args: [key, getAddress(usdc), USDC_TRANSFER_SELECTOR, conditions.map((c) => ({ parent: c.parent, paramType: c.paramType, operator: c.operator, compValue: c.compValue })), ExecutionOptions.None],
    }),
  };
}

/** enableModule + assignRoles + scopeTarget + scopeFunction + setAllowance, executed by the Safe in one 2-of-3 tx. */
export function buildBountyPayerSetup(s: BountyPayerSetup): MetaTransactionData[] {
  const key = roleKey(BOUNTY_PAYER_ROLE);
  const module = getAddress(s.rolesModule);
  const per = s.allowancePerPeriodUsdc6 ?? ALLOWANCE_PER_PERIOD_USDC6;
  const period = s.periodSeconds ?? ALLOWANCE_PERIOD_S;
  const call = (data: Hex, to: Address = module): MetaTransactionData => ({ to, value: "0", data, operation: OperationType.Call });
  return [
    call(encodeFunctionData({ abi: SAFE_ABI, functionName: "enableModule", args: [module] }), getAddress(s.safe)),
    call(encodeFunctionData({ abi: ROLES_ABI, functionName: "assignRoles", args: [getAddress(s.keeper), [key], [true]] })),
    call(encodeFunctionData({ abi: ROLES_ABI, functionName: "scopeTarget", args: [key, getAddress(s.usdc)] })),
    buildScopeFunctionTx(s),
    // balance starts full; refills `per` every `period` up to `per` (timestamp 0 = start now)
    call(encodeFunctionData({ abi: ROLES_ABI, functionName: "setAllowance", args: [key, per, per, per, BigInt(period), 0n] })),
  ];
}

export function describeBountyPayerSetup(s: BountyPayerSetup): string[] {
  const max = s.maxAmountUsdc6 ?? MAX_BOUNTY_USDC6;
  const per = s.allowancePerPeriodUsdc6 ?? ALLOWANCE_PER_PERIOD_USDC6;
  return [
    `Safe ${s.safe} enables Roles module ${s.rolesModule}`,
    `role "${BOUNTY_PAYER_ROLE}" (${roleKey()}) member: keeper ${s.keeper}`,
    `target USDC ${s.usdc} · transfer(address,uint256) only · no ETH · no delegatecall`,
    `to ∈ ${s.allowedRecipients.length} allowed recipient(s); amount ≤ ${Number(max) / 1e6} USDC per transfer`,
    `allowance ${Number(per) / 1e6} USDC per ${(s.periodSeconds ?? ALLOWANCE_PERIOD_S) / 3600} h`,
    "everything else stays 2-of-3; the agent cannot edit the recipient set",
  ];
}

/** Turn a batch into one MetaTransaction; default = Protocol Kit MultiSend via the injected builder. */
export type BatchBuilder = (safe: Address, txs: MetaTransactionData[]) => Promise<MetaTransactionData>;

export interface EnableRolesOptions {
  chain: ChainAddresses;
  entitySlug: string;
  safe: Address;
  keeper: Address;
  allowedRecipients: readonly Address[];
  proposer: ChainAccount;
  apiKit: Pick<ApiKitLike, "getNextNonce" | "proposeTransaction">;
  store: ConfigStore;
  batch: BatchBuilder;
  /** whether the module proxy already exists (code at predicted address) and how to deploy it */
  moduleExists: (addr: Address) => Promise<boolean>;
  deployModule: (tx: { to: Address; data: Hex }) => Promise<Hex>;
  dryRun?: boolean;
  log?: (line: string) => void;
}

/** Deploy the module proxy if needed (deployer pays), then PROPOSE the enabling batch. Humans sign. */
export async function enableRoles(o: EnableRolesOptions): Promise<{ rolesModule: Address; safeTxHash: Hex | null; lines: string[] }> {
  const { chain, entitySlug, safe, log = () => {}, dryRun = false } = o;
  const rolesModule = predictRolesModuleAddress({ factory: chain.moduleProxyFactory.address, mastercopy: chain.rolesModifierMastercopy.address, safe, entitySlug });
  if (!(await o.moduleExists(rolesModule))) {
    const tx = deployRolesModuleTx({ factory: chain.moduleProxyFactory.address, mastercopy: chain.rolesModifierMastercopy.address, safe, entitySlug });
    log(`deploy Roles module proxy → ${rolesModule} via factory ${tx.to}`);
    if (!dryRun) await o.deployModule(tx);
  } else {
    log(`Roles module proxy exists at ${rolesModule}`);
  }
  const setup: BountyPayerSetup = { safe, rolesModule, usdc: chain.usdc.address, keeper: o.keeper, allowedRecipients: o.allowedRecipients };
  const lines = describeBountyPayerSetup(setup);
  for (const l of lines) log(`  ${l}`);
  const txs = buildBountyPayerSetup(setup);
  const single = await o.batch(safe, txs);
  const { safeTxHash } = await proposeTransaction({ apiKit: o.apiKit, chainId: chain.chainId, safeAddress: safe, tx: single, proposer: o.proposer, origin: "kami:enable-roles", dryRun, log });
  if (!dryRun) {
    await writeIfChanged(o.store, `roles.${entitySlug}.module`, rolesModule);
    await writeIfChanged(o.store, `roles.${entitySlug}.enableTxHash`, safeTxHash);
  }
  return { rolesModule, safeTxHash: dryRun ? null : safeTxHash, lines };
}

/** Re-scope `transfer` with a new recipient list — again only PROPOSED; two guardians sign. */
export async function updateAllowedRecipients(o: Omit<EnableRolesOptions, "keeper" | "batch" | "moduleExists" | "deployModule"> & { rolesModule?: Address }): Promise<{ safeTxHash: Hex | null }> {
  const { chain, entitySlug, safe, log = () => {}, dryRun = false } = o;
  const stored = await o.store.get(`roles.${entitySlug}.module`);
  const rolesModule = o.rolesModule ?? (typeof stored === "string" ? getAddress(stored) : undefined);
  if (!rolesModule) throw new Error(`roles.${entitySlug}.module is not in config; run enable-roles first`);
  const tx = buildScopeFunctionTx({ rolesModule, usdc: chain.usdc.address, allowedRecipients: o.allowedRecipients });
  log(`update allowedRecipients on ${rolesModule}: ${o.allowedRecipients.length} address(es)`);
  const { safeTxHash } = await proposeTransaction({ apiKit: o.apiKit, chainId: chain.chainId, safeAddress: safe, tx, proposer: o.proposer, origin: "kami:update-recipients", dryRun, log });
  return { safeTxHash: dryRun ? null : safeTxHash };
}
