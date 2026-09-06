/**
 * `kami-chain <command> [flags]` — every command honours `--dry-run` (prints the
 * calls, sends nothing). Chain: `CHAIN_ID` (84532 default, 8453 opt-in), `RPC_URL`.
 * Config: `PLATFORM_URL` + `PLATFORM_ADMIN_TOKEN` → HTTP store, else state/config.<chainId>.json.
 *
 *   addresses                                   print the chain table and what is still *verify*
 *   register-schemas  --key-env ATTESTER_KEY
 *   deploy-hats       --entity <slug> --key-env DEPLOYER_KEY
 *   predict-safe      --entity <slug> --owners a,b,c
 *   deploy-safe       --entity <slug> --owners a,b,c --key-env DEPLOYER_KEY
 *   add-delegate      --entity <slug> --safe 0x… --delegate 0x… --label "kami proposer" --key-env GUARDIAN_KEY
 *   attest-entity     --entity <slug> --twin-uri <uri> --safe 0x… --guardians-hat <id> --key-env ATTESTER_KEY
 *   enable-roles      --entity <slug> --safe 0x… --keeper 0x… --recipients a,b --key-env DEPLOYER_KEY --proposer-key-env PROPOSER_KEY
 *   update-recipients --entity <slug> --safe 0x… --recipients a,b --proposer-key-env PROPOSER_KEY
 */
import Safe from "@safe-global/protocol-kit";
import { type Address, getAddress, isAddress } from "viem";
import { chainFromEnv, unverifiedAddresses } from "./addresses.js";
import { attestEntityRegistered } from "./attest-entity-registered.js";
import { configStoreFromEnv } from "./config.js";
import { deployHatsTree, hatsFor } from "./deploy-hats-tree.js";
import { addDelegate, deploySafe, predictSafeAddress } from "./deploy-safe.js";
import { easFor } from "./eas.js";
import { enableRoles, updateAllowedRecipients } from "./enable-roles.js";
import { registerEasSchemas, schemaRegistryFor } from "./register-eas-schemas.js";
import { type MetaTransactionData, apiKitFor } from "./safe-tx.js";
import { accountFromEnv, ethersSignerFor, publicClientFor, walletClientFor } from "./signer.js";

export interface ParsedArgs {
  command: string | undefined;
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  let command: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const [k, inline] = a.slice(2).split("=", 2);
      if (inline !== undefined) flags[k!] = inline;
      else if (i + 1 < argv.length && !argv[i + 1]!.startsWith("--")) flags[k!] = argv[++i]!;
      else flags[k!] = true;
    } else if (!command) command = a;
  }
  return { command, flags };
}

function str(flags: ParsedArgs["flags"], k: string): string {
  const v = flags[k];
  if (typeof v !== "string" || v === "") throw new Error(`--${k} is required`);
  return v;
}
function addr(flags: ParsedArgs["flags"], k: string): Address {
  const v = str(flags, k);
  if (!isAddress(v)) throw new Error(`--${k} is not an address`);
  return getAddress(v);
}
function addrList(flags: ParsedArgs["flags"], k: string): Address[] {
  return str(flags, k)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      if (!isAddress(s)) throw new Error(`--${k}: ${s} is not an address`);
      return getAddress(s);
    });
}

export async function main(argv = process.argv.slice(2), out: (l: string) => void = console.log): Promise<number> {
  const { command, flags } = parseArgs(argv);
  const dryRun = flags["dry-run"] === true;
  const chain = chainFromEnv();
  const log = (l: string) => out(`${dryRun ? "[dry-run] " : ""}${l}`);
  const store = configStoreFromEnv(chain.chainId);
  const banner = () => {
    out(`chain ${chain.name} (${chain.chainId}) rpc ${chain.rpcUrl}`);
    const un = unverifiedAddresses(chain);
    if (un.length) out(`unverified addresses (docs/verify.md): ${un.map((u) => `${u.key}=${u.address}`).join(" ")}`);
  };

  switch (command) {
    case "addresses": {
      banner();
      for (const [k, v] of Object.entries(chain)) if (v && typeof v === "object" && "address" in v) out(`${k}\t${v.address}\t${v.verified ? "verified" : "VERIFY"}\t${v.source}`);
      return 0;
    }
    case "register-schemas": {
      banner();
      const signer = dryRun ? undefined : ethersSignerFor(accountFromEnv(str(flags, "key-env")), chain);
      await registerEasSchemas({ registry: schemaRegistryFor(chain, signer), store, dryRun, log });
      return 0;
    }
    case "deploy-hats": {
      banner();
      const account = accountFromEnv(str(flags, "key-env"));
      const hats = hatsFor(chain, publicClientFor(chain), walletClientFor(chain, account), account.address);
      await deployHatsTree({ entitySlug: str(flags, "entity"), hats, store, deployer: account.address, dryRun, log });
      return 0;
    }
    case "predict-safe": {
      const address = await predictSafeAddress({ chain, entitySlug: str(flags, "entity"), owners: addrList(flags, "owners") });
      out(address);
      return 0;
    }
    case "deploy-safe": {
      banner();
      const r = await deploySafe({ chain, entitySlug: str(flags, "entity"), owners: addrList(flags, "owners"), deployer: accountFromEnv(str(flags, "key-env")), store, dryRun, log });
      out(`${r.action} ${r.address}${r.txHash ? ` tx ${r.txHash}` : ""}`);
      return 0;
    }
    case "add-delegate": {
      banner();
      const guardian = walletClientFor(chain, accountFromEnv(str(flags, "key-env")));
      const r = await addDelegate({ apiKit: apiKitFor(chain), safeAddress: addr(flags, "safe"), delegate: addr(flags, "delegate"), label: str(flags, "label"), guardian, entitySlug: str(flags, "entity"), store, dryRun, log });
      out(r.action);
      return 0;
    }
    case "attest-entity": {
      banner();
      const eas = easFor(chain, dryRun ? undefined : ethersSignerFor(accountFromEnv(str(flags, "key-env")), chain));
      const r = await attestEntityRegistered({ eas, entitySlug: str(flags, "entity"), twinEntityURI: str(flags, "twin-uri"), safe: addr(flags, "safe"), guardiansHatId: BigInt(str(flags, "guardians-hat")), store, dryRun, log });
      out(`${r.action}${r.uid ? ` ${r.uid}` : ""}`);
      return 0;
    }
    case "enable-roles":
    case "update-recipients": {
      banner();
      const safe = addr(flags, "safe");
      const proposer = accountFromEnv(str(flags, "proposer-key-env"));
      const common = { chain, entitySlug: str(flags, "entity"), safe, allowedRecipients: addrList(flags, "recipients"), proposer, apiKit: apiKitFor(chain), store, dryRun, log };
      if (command === "update-recipients") {
        const r = await updateAllowedRecipients(common);
        out(`proposed ${r.safeTxHash ?? "(dry-run)"}`);
        return 0;
      }
      const deployer = accountFromEnv(str(flags, "key-env"));
      const pub = publicClientFor(chain);
      const wallet = walletClientFor(chain, deployer);
      const r = await enableRoles({
        ...common,
        keeper: addr(flags, "keeper"),
        moduleExists: async (a) => ((await pub.getCode({ address: a })) ?? "0x") !== "0x",
        deployModule: async (tx) => {
          const hash = await wallet.sendTransaction({ account: deployer, chain: chain.viemChain, to: tx.to, data: tx.data });
          await pub.waitForTransactionReceipt({ hash });
          return hash;
        },
        batch: async (safeAddress, txs): Promise<MetaTransactionData> => {
          const sdk = await Safe.init({ provider: chain.rpcUrl, safeAddress });
          const t = await sdk.createTransaction({ transactions: txs, onlyCalls: true });
          return { to: getAddress(t.data.to), value: t.data.value, data: t.data.data as `0x${string}`, operation: t.data.operation };
        },
      });
      out(`module ${r.rolesModule}; proposed ${r.safeTxHash ?? "(dry-run)"} — two guardians must sign`);
      return 0;
    }
    default:
      out("usage: kami-chain <addresses|register-schemas|deploy-hats|predict-safe|deploy-safe|add-delegate|attest-entity|enable-roles|update-recipients> [--dry-run] …");
      return command ? 1 : 0;
  }
}

if (process.argv[1] && /cli\.(ts|js)$/.test(process.argv[1])) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    },
  );
}
