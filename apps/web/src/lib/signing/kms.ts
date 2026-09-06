/**
 * Key custody for the signing service (architecture §7.2, §10.2, ADR-E05).
 *
 * Roles: `proposer:<slug>` (one per entity, Tx-Service delegate), `attester`
 * (EAS), `relayer` (pays gas, owns nothing), `deployer` (Safe/Hats/Roles
 * deployments), `keeper` (Roles allowance phase). A backend can produce a
 * signature for a role and tell you its address; it can never hand out key
 * material. Serialising a backend (`JSON.stringify`) or an error it throws
 * never includes a private key — `kms.test.ts` asserts it.
 *
 *  - `LocalKeyBackend`         dev/test only; refuses to start in production
 *  - `PrivyServerWalletBackend` Privy server wallets + authorization key (*verify* docs/verify.md #11)
 *  - `AwsKmsBackend`           documented stub; throws `NotConfigured` (no new dependency)
 *
 * `accountFor(backend, role)` adapts a role to the viem `LocalAccount` that
 * `@kami/chain` takes everywhere (its `ChainAccount`).
 */
import type { Address, Hex, LocalAccount, TransactionSerializable, TypedDataDefinition } from "viem";
import { getAddress, hexToBytes, isHex, keccak256 } from "viem";
import { generatePrivateKey, privateKeyToAccount, toAccount } from "viem/accounts";
import { isProduction, signingEnv, type SigningEnv } from "./env";

export type ProposerRole = `proposer:${string}`;
export type KeyRole = ProposerRole | "attester" | "relayer" | "deployer" | "keeper";

const FIXED_ROLES = new Set(["attester", "relayer", "deployer", "keeper"]);

export function isKeyRole(role: string): role is KeyRole {
  return FIXED_ROLES.has(role) || /^proposer:[a-z0-9-]{1,64}$/.test(role);
}

export function proposerRole(slug: string): ProposerRole {
  if (!/^[a-z0-9-]{1,64}$/.test(slug)) throw new SigningError(`bad entity slug for proposer role`);
  return `proposer:${slug}`;
}

export type SignableMessage = string | { raw: Hex | Uint8Array };

export interface KeyBackend {
  readonly kind: "local" | "privy" | "aws-kms";
  getAddress(role: KeyRole): Promise<Address>;
  signTypedData(role: KeyRole, typed: TypedDataDefinition): Promise<Hex>;
  signTransaction(role: KeyRole, tx: TransactionSerializable): Promise<Hex>;
  signMessage(role: KeyRole, message: SignableMessage): Promise<Hex>;
  /** Serialisation is deliberately shallow: kind + role names, never material. */
  toJSON(): { kind: string; roles: string[] };
}

// ---------------------------------------------------------------------------
// errors — every message passes through `scrub`
// ---------------------------------------------------------------------------

const KEY_RE = /(?:0x)?[0-9a-fA-F]{64}/g;

/** Replace anything that looks like 32 bytes of hex; an error message may name a role, never a key. */
export function scrub(text: string): string {
  return text.replace(KEY_RE, "[redacted-32-bytes]");
}

export class SigningError extends Error {
  constructor(message: string, readonly role?: KeyRole) {
    super(scrub(message));
    this.name = "SigningError";
  }
  toJSON() {
    return { name: this.name, message: this.message, role: this.role ?? null };
  }
}

export class NotConfigured extends SigningError {
  constructor(message: string, role?: KeyRole) {
    super(message, role);
    this.name = "NotConfigured";
  }
}

export class UnknownRole extends SigningError {
  constructor(role: string) {
    super(`no key for role ${role}`, isKeyRole(role) ? role : undefined);
    this.name = "UnknownRole";
  }
}

// ---------------------------------------------------------------------------
// LocalKeyBackend — dev/test only
// ---------------------------------------------------------------------------

function parseKeysJson(raw: string | undefined): Map<string, Hex> {
  const out = new Map<string, Hex>();
  if (!raw) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SigningError("KAMI_LOCAL_KEYS_JSON is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object") throw new SigningError("KAMI_LOCAL_KEYS_JSON must be an object of role → key");
  for (const [role, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!isKeyRole(role)) throw new SigningError(`KAMI_LOCAL_KEYS_JSON: unknown role ${role}`);
    const key = typeof value === "string" ? (value.startsWith("0x") ? value : `0x${value}`) : "";
    if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new SigningError(`KAMI_LOCAL_KEYS_JSON: role ${role} is not a 32-byte hex key`);
    out.set(role, key as Hex);
  }
  return out;
}

export class LocalKeyBackend implements KeyBackend {
  readonly kind = "local" as const;
  // Private class fields are invisible to JSON.stringify, Object.keys and util.inspect's default depth.
  readonly #accounts = new Map<string, LocalAccount>();
  readonly #ephemeral: boolean;

  constructor(opts: { keys?: Map<string, Hex> | Record<string, Hex>; ephemeral?: boolean; env?: NodeJS.ProcessEnv } = {}) {
    const env = opts.env ?? process.env;
    if (isProduction(env)) throw new NotConfigured("LocalKeyBackend refuses to start in production (set SIGNING_BACKEND=privy or aws-kms)");
    const keys = opts.keys instanceof Map ? opts.keys : new Map(Object.entries(opts.keys ?? {}));
    for (const [role, key] of keys) this.#accounts.set(role, privateKeyToAccount(key));
    this.#ephemeral = opts.ephemeral ?? true;
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): LocalKeyBackend {
    return new LocalKeyBackend({ keys: parseKeysJson(env.KAMI_LOCAL_KEYS_JSON), ephemeral: true, env });
  }

  roles(): string[] {
    return [...this.#accounts.keys()].sort();
  }

  #account(role: KeyRole): LocalAccount {
    let a = this.#accounts.get(role);
    if (!a) {
      if (!this.#ephemeral) throw new UnknownRole(role);
      a = privateKeyToAccount(generatePrivateKey());
      this.#accounts.set(role, a);
    }
    return a;
  }

  async getAddress(role: KeyRole): Promise<Address> {
    return this.#account(role).address;
  }
  async signTypedData(role: KeyRole, typed: TypedDataDefinition): Promise<Hex> {
    return this.#account(role).signTypedData(typed as Parameters<LocalAccount["signTypedData"]>[0]);
  }
  async signTransaction(role: KeyRole, tx: TransactionSerializable): Promise<Hex> {
    return this.#account(role).signTransaction(tx);
  }
  async signMessage(role: KeyRole, message: SignableMessage): Promise<Hex> {
    return this.#account(role).signMessage({ message });
  }
  toJSON() {
    return { kind: this.kind, roles: this.roles() };
  }
  /** util.inspect / console.log go through here too. */
  [Symbol.for("nodejs.util.inspect.custom")]() {
    return `LocalKeyBackend(${this.roles().join(",")})`;
  }
}

// ---------------------------------------------------------------------------
// PrivyServerWalletBackend — *verify* (docs/verify.md #11)
// ---------------------------------------------------------------------------

/** The slice of `PrivyClient.walletApi.ethereum` this backend calls (@privy-io/server-auth 1.32.5 types). */
export interface PrivyEthereumApiLike {
  signMessage(input: { walletId: string; message: string | Uint8Array }): Promise<{ signature: string }>;
  signTypedData(input: {
    walletId: string;
    typedData: { domain: Record<string, unknown>; types: Record<string, unknown>; message: Record<string, unknown>; primaryType: string };
  }): Promise<{ signature: string }>;
  signTransaction(input: { walletId: string; transaction: Record<string, unknown> }): Promise<{ signedTransaction: string }>;
}

export type PrivyWalletMap = Record<string, { walletId: string; address: Address }>;

function parseWalletMap(raw: string | undefined): PrivyWalletMap {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SigningError("PRIVY_WALLET_IDS_JSON is not valid JSON");
  }
  const out: PrivyWalletMap = {};
  for (const [role, v] of Object.entries((parsed ?? {}) as Record<string, { walletId?: string; address?: string }>)) {
    if (!isKeyRole(role)) throw new SigningError(`PRIVY_WALLET_IDS_JSON: unknown role ${role}`);
    if (!v?.walletId || !v.address) throw new SigningError(`PRIVY_WALLET_IDS_JSON: role ${role} needs walletId and address`);
    out[role] = { walletId: v.walletId, address: getAddress(v.address) };
  }
  return out;
}

/** bigint → hex quantity for the Privy RPC body. */
function q(v: bigint | number | undefined): Hex | undefined {
  if (v === undefined) return undefined;
  return `0x${BigInt(v).toString(16)}`;
}

/** JSON-safe copy of typed data (bigint → decimal string, as eth_signTypedData_v4 expects). */
export function jsonTypedData(typed: TypedDataDefinition): {
  domain: Record<string, unknown>;
  types: Record<string, unknown>;
  message: Record<string, unknown>;
  primaryType: string;
} {
  const conv = (v: unknown): unknown =>
    typeof v === "bigint" ? v.toString() : Array.isArray(v) ? v.map(conv) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, conv(x)])) : v;
  const types = { ...(typed.types as Record<string, unknown>) };
  if (!("EIP712Domain" in types)) {
    const d = (typed.domain ?? {}) as Record<string, unknown>;
    const fields: Array<{ name: string; type: string }> = [];
    if (d.name !== undefined) fields.push({ name: "name", type: "string" });
    if (d.version !== undefined) fields.push({ name: "version", type: "string" });
    if (d.chainId !== undefined) fields.push({ name: "chainId", type: "uint256" });
    if (d.verifyingContract !== undefined) fields.push({ name: "verifyingContract", type: "address" });
    if (d.salt !== undefined) fields.push({ name: "salt", type: "bytes32" });
    types.EIP712Domain = fields;
  }
  return {
    domain: conv(typed.domain ?? {}) as Record<string, unknown>,
    types,
    message: conv(typed.message) as Record<string, unknown>,
    primaryType: String(typed.primaryType),
  };
}

/**
 * Privy server wallets: one wallet per role, created once in the dashboard or
 * via `walletApi.createWallet`, with an authorization keypair whose private
 * half lives only in `PRIVY_AUTHORIZATION_KEY`. *verify*: method names and
 * response shapes were taken from the installed 1.32.5 type declarations
 * (`walletApi.ethereum.{signMessage, signTypedData, signTransaction}`); the
 * transaction body's field names (`gasLimit`, hex quantities) and the
 * signature encoding (`hex`) need one live call on Base Sepolia.
 */
export class PrivyServerWalletBackend implements KeyBackend {
  readonly kind = "privy" as const;
  readonly #api: PrivyEthereumApiLike;
  readonly #wallets: PrivyWalletMap;

  constructor(opts: { api: PrivyEthereumApiLike; wallets: PrivyWalletMap }) {
    this.#api = opts.api;
    this.#wallets = opts.wallets;
  }

  /** Builds the real client lazily so importing this module never touches the network. */
  static async fromEnv(env: SigningEnv = signingEnv()): Promise<PrivyServerWalletBackend> {
    if (!env.PRIVY_APP_ID || !env.PRIVY_APP_SECRET) throw new NotConfigured("PRIVY_APP_ID / PRIVY_APP_SECRET are not set");
    if (!env.PRIVY_AUTHORIZATION_KEY) throw new NotConfigured("PRIVY_AUTHORIZATION_KEY is not set (wallet RPCs would be refused)");
    const wallets = parseWalletMap(env.PRIVY_WALLET_IDS_JSON);
    const { PrivyClient } = await import("@privy-io/server-auth");
    const client = new PrivyClient(env.PRIVY_APP_ID, env.PRIVY_APP_SECRET, { walletApi: { authorizationPrivateKey: env.PRIVY_AUTHORIZATION_KEY } });
    return new PrivyServerWalletBackend({ api: client.walletApi.ethereum as unknown as PrivyEthereumApiLike, wallets });
  }

  #wallet(role: KeyRole) {
    const w = this.#wallets[role];
    if (!w) throw new UnknownRole(role);
    return w;
  }

  async getAddress(role: KeyRole): Promise<Address> {
    return this.#wallet(role).address;
  }
  async signTypedData(role: KeyRole, typed: TypedDataDefinition): Promise<Hex> {
    const r = await this.#api.signTypedData({ walletId: this.#wallet(role).walletId, typedData: jsonTypedData(typed) });
    return asHex(r.signature, role);
  }
  async signTransaction(role: KeyRole, tx: TransactionSerializable): Promise<Hex> {
    const t = tx as TransactionSerializable & { gas?: bigint; nonce?: number; chainId?: number };
    const transaction: Record<string, unknown> = {
      to: t.to ?? undefined,
      data: t.data ?? undefined,
      value: q(t.value),
      nonce: t.nonce,
      chainId: t.chainId,
      gasLimit: q(t.gas),
      type: t.type === "legacy" ? 0 : 2,
      ...(t.type === "legacy"
        ? { gasPrice: q(t.gasPrice) }
        : { maxFeePerGas: q((t as { maxFeePerGas?: bigint }).maxFeePerGas), maxPriorityFeePerGas: q((t as { maxPriorityFeePerGas?: bigint }).maxPriorityFeePerGas) }),
    };
    for (const k of Object.keys(transaction)) if (transaction[k] === undefined) delete transaction[k];
    const r = await this.#api.signTransaction({ walletId: this.#wallet(role).walletId, transaction });
    return asHex(r.signedTransaction, role);
  }
  async signMessage(role: KeyRole, message: SignableMessage): Promise<Hex> {
    const m = typeof message === "string" ? message : typeof message.raw === "string" ? hexToBytes(message.raw) : message.raw;
    const r = await this.#api.signMessage({ walletId: this.#wallet(role).walletId, message: m });
    return asHex(r.signature, role);
  }
  toJSON() {
    return { kind: this.kind, roles: Object.keys(this.#wallets).sort() };
  }
  [Symbol.for("nodejs.util.inspect.custom")]() {
    return `PrivyServerWalletBackend(${Object.keys(this.#wallets).sort().join(",")})`;
  }
}

function asHex(sig: string, role: KeyRole): Hex {
  const h = sig.startsWith("0x") ? sig : `0x${sig}`;
  if (!isHex(h)) throw new SigningError("backend returned a non-hex signature", role);
  return h as Hex;
}

// ---------------------------------------------------------------------------
// AwsKmsBackend — documented stub
// ---------------------------------------------------------------------------

/**
 * Not implemented, on purpose: adding `@aws-sdk/client-kms` is a dependency
 * decision for the owner (§7.2 "Privy server wallets … or AWS KMS"). The
 * implementation would be:
 *   - one `ECC_SECG_P256K1` / `SIGN_VERIFY` key per role, ids in `AWS_KMS_KEY_IDS_JSON`;
 *   - `GetPublicKeyCommand` → DER SPKI → uncompressed point → keccak256 → address;
 *   - `SignCommand({SigningAlgorithm: "ECDSA_SHA_256", MessageType: "DIGEST", Message: hash})`
 *     → DER (r, s) → low-s normalisation → recovery id by trying v ∈ {27, 28}
 *     against the address; then viem's `toAccount` over `{signMessage, signTransaction, signTypedData}`
 *     hashing with `hashMessage`, `keccak256(serializeTransaction(tx))`, `hashTypedData`.
 */
export class AwsKmsBackend implements KeyBackend {
  readonly kind = "aws-kms" as const;
  readonly #keyIds: Record<string, string>;
  constructor(keyIds: Record<string, string> = {}) {
    this.#keyIds = keyIds;
  }
  static fromEnv(env: SigningEnv = signingEnv()): AwsKmsBackend {
    let ids: Record<string, string> = {};
    if (env.AWS_KMS_KEY_IDS_JSON) {
      try {
        ids = JSON.parse(env.AWS_KMS_KEY_IDS_JSON) as Record<string, string>;
      } catch {
        throw new SigningError("AWS_KMS_KEY_IDS_JSON is not valid JSON");
      }
    }
    return new AwsKmsBackend(ids);
  }
  #notConfigured(role: KeyRole): never {
    throw new NotConfigured(
      `AwsKmsBackend is a stub: install @aws-sdk/client-kms (GetPublicKeyCommand + SignCommand ECDSA_SHA_256/DIGEST) and implement kms.ts; key id for ${role}: ${this.#keyIds[role] ? "configured" : "missing"}`,
      role,
    );
  }
  async getAddress(role: KeyRole): Promise<Address> {
    return this.#notConfigured(role);
  }
  async signTypedData(role: KeyRole): Promise<Hex> {
    return this.#notConfigured(role);
  }
  async signTransaction(role: KeyRole): Promise<Hex> {
    return this.#notConfigured(role);
  }
  async signMessage(role: KeyRole): Promise<Hex> {
    return this.#notConfigured(role);
  }
  toJSON() {
    return { kind: this.kind, roles: Object.keys(this.#keyIds).sort() };
  }
}

// ---------------------------------------------------------------------------
// selection + the viem account adapter
// ---------------------------------------------------------------------------

let cached: KeyBackend | null = null;

/** `SIGNING_BACKEND` picks the backend; unset means `local` outside production and a hard refusal inside it. */
export async function getKeyBackend(env: SigningEnv = signingEnv()): Promise<KeyBackend> {
  if (cached) return cached;
  const choice = env.SIGNING_BACKEND ?? (isProduction(process.env) ? undefined : "local");
  switch (choice) {
    case "local":
      cached = LocalKeyBackend.fromEnv(process.env);
      break;
    case "privy":
      cached = await PrivyServerWalletBackend.fromEnv(env);
      break;
    case "aws-kms":
      cached = AwsKmsBackend.fromEnv(env);
      break;
    default:
      throw new NotConfigured("SIGNING_BACKEND is unset in production (privy | aws-kms)");
  }
  return cached;
}

export function setKeyBackendForTests(b: KeyBackend | null): void {
  cached = b;
}

/**
 * A viem `LocalAccount` whose every signing call goes to the backend — what
 * `@kami/chain` (`ChainAccount`) and viem wallet clients take. The address is
 * resolved once, up front, so the account is synchronous afterwards.
 */
export async function accountFor(backend: KeyBackend, role: KeyRole): Promise<LocalAccount> {
  const address = await backend.getAddress(role);
  return toAccount({
    address,
    signMessage: ({ message }) => backend.signMessage(role, message as SignableMessage),
    signTransaction: (tx) => backend.signTransaction(role, tx as TransactionSerializable),
    signTypedData: (typed) => backend.signTypedData(role, typed as TypedDataDefinition),
  });
}

/** Stable, non-secret fingerprint of a role's address for logs and `entity_events`. */
export async function roleFingerprint(backend: KeyBackend, role: KeyRole): Promise<string> {
  const a = await backend.getAddress(role);
  return keccak256(a).slice(0, 10);
}
