/**
 * Where the scripts record what they deployed, so re-runs are idempotent
 * (architecture §12.3: "each idempotent and recording addresses in `config`").
 *
 * Keys written by this package (all namespaced, values JSON):
 *   eas.schema.<Name>                       schema UID
 *   eas.attestation.EntityRegistered.<slug> attestation UID
 *   hats.tree.<slug>.topHat                 top hat id (decimal string)
 *   hats.tree.<slug>.<Role>                 child hat id (decimal string)
 *   safe.<slug>.address                     Safe address
 *   safe.<slug>.proposer                    delegate (proposer) address
 *   roles.<slug>.module                     Roles Modifier address
 *   roles.<slug>.enableTxHash               safeTxHash of the proposed enable tx
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";

export type ConfigValue = string | number | boolean | null | ConfigValue[] | { [k: string]: ConfigValue };

export interface ConfigStore {
  get(key: string): Promise<ConfigValue | undefined>;
  set(key: string, value: ConfigValue): Promise<void>;
}

/** In-memory store for tests and dry runs. Counts writes so idempotency is measurable. */
export class MemoryConfigStore implements ConfigStore {
  readonly data = new Map<string, ConfigValue>();
  writes = 0;
  constructor(initial?: Record<string, ConfigValue>) {
    for (const [k, v] of Object.entries(initial ?? {})) this.data.set(k, v);
  }
  async get(key: string) {
    return this.data.get(key);
  }
  async set(key: string, value: ConfigValue) {
    this.writes += 1;
    this.data.set(key, value);
  }
}

/** `infra/chain/state/config.<chainId>.json` — gitignored except the example. */
export class JsonFileConfigStore implements ConfigStore {
  writes = 0;
  constructor(readonly path: string) {}
  private read(): Record<string, ConfigValue> {
    if (!existsSync(this.path)) return {};
    return JSON.parse(readFileSync(this.path, "utf8")) as Record<string, ConfigValue>;
  }
  async get(key: string) {
    return this.read()[key];
  }
  async set(key: string, value: ConfigValue) {
    const all = this.read();
    all[key] = value;
    mkdirSync(dirname(this.path), { recursive: true });
    const sorted = Object.fromEntries(Object.entries(all).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    writeFileSync(this.path, JSON.stringify(sorted, null, 2) + "\n");
    this.writes += 1;
  }
}

/**
 * Posts to the platform's admin config route (`PLATFORM_URL/api/admin/config`,
 * bearer `PLATFORM_ADMIN_TOKEN`). The route is a later work package (WP6);
 * the wire shape here is `GET ?key=` → `{key, value}` / 404, `POST {key, value}`.
 */
export class HttpConfigStore implements ConfigStore {
  writes = 0;
  constructor(
    readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}
  private url(q = "") {
    return `${this.baseUrl.replace(/\/$/, "")}/api/admin/config${q}`;
  }
  async get(key: string) {
    const r = await this.fetchImpl(this.url(`?key=${encodeURIComponent(key)}`), {
      headers: { authorization: `Bearer ${this.token}` },
    });
    if (r.status === 404) return undefined;
    if (!r.ok) throw new Error(`config GET ${key}: HTTP ${r.status}`);
    const body = (await r.json()) as { value?: ConfigValue };
    return body.value;
  }
  async set(key: string, value: ConfigValue) {
    const r = await this.fetchImpl(this.url(), {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
    if (!r.ok) throw new Error(`config POST ${key}: HTTP ${r.status}`);
    this.writes += 1;
  }
}

/** Write only when the stored value differs — the idempotency primitive every script uses. */
export async function writeIfChanged(store: ConfigStore, key: string, value: ConfigValue): Promise<boolean> {
  const current = await store.get(key);
  if (current !== undefined && JSON.stringify(current) === JSON.stringify(value)) return false;
  await store.set(key, value);
  return true;
}

export function statePathFor(chainId: number, dir = new URL("../state/", import.meta.url).pathname): string {
  return `${dir.replace(/\/$/, "")}/config.${chainId}.json`;
}

/**
 * `PLATFORM_URL` + `PLATFORM_ADMIN_TOKEN` → HTTP store; otherwise the JSON file
 * for the chain. Scripts never need to know which.
 */
export function configStoreFromEnv(chainId: number, env: NodeJS.ProcessEnv = process.env): ConfigStore {
  if (env.PLATFORM_URL && env.PLATFORM_ADMIN_TOKEN) return new HttpConfigStore(env.PLATFORM_URL, env.PLATFORM_ADMIN_TOKEN);
  return new JsonFileConfigStore(env.KAMI_CHAIN_STATE ?? statePathFor(chainId));
}
