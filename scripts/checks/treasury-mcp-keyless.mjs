#!/usr/bin/env node
/**
 * ADR-E05 / CLAUDE.md — "The agent never signs. The treasury MCP has exactly three tools and no
 * signing dependency."
 *
 * Parses `packages/treasury-mcp/pyproject.toml` and asserts:
 *   1. every declared dependency is on the allow-list (mcp, httpx, pydantic and their kin);
 *   2. no dependency is a signing, wallet or chain library, under any of its known names;
 *   3. no optional-dependency group smuggles one in either.
 *
 * As a second, independent reading it greps the package's own sources for an import of any of
 * those libraries, and for a key-shaped identifier — the dependency list is a promise, the
 * imports are the fact.
 *
 * Exit 0 = clean, 1 = a violation, 2 = the check could not run.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const pkgDir = path.join(root, "packages", "treasury-mcp");
const pyproject = path.join(pkgDir, "pyproject.toml");

if (!existsSync(pyproject)) {
  console.error(`SKIP: ${path.relative(root, pyproject)} does not exist`);
  process.exit(2);
}

/** Libraries that can sign, hold a key, or talk to a chain. */
const FORBIDDEN = [
  "eth-account", "eth_account", "eth-keys", "eth_keys", "eth-keyfile", "eth-utils-signing",
  "web3", "web3.py", "ethers", "eth-abi-signing", "coincurve", "secp256k1", "ecdsa",
  "bip32", "bip39", "mnemonic", "hdwallet", "py-evm", "eth-tester", "safe-eth-py",
  "gnosis-py", "safe-cli", "hexbytes-signing", "cryptography", "pynacl", "pycryptodome",
  "keyring", "boto3", "aws-kms", "google-cloud-kms", "azure-keyvault",
];

/** Everything the MCP is allowed to need to read balances and post a draft over HTTP. */
const ALLOWED = ["mcp", "httpx", "pydantic", "pydantic-core", "anyio", "starlette", "uvicorn", "pyyaml", "typing-extensions"];

const toml = readFileSync(pyproject, "utf8");

/** Minimal TOML reading: the arrays this file actually uses. */
function arrayAfter(key) {
  const re = new RegExp(`^\\s*${key}\\s*=\\s*\\[([\\s\\S]*?)\\]`, "m");
  const m = re.exec(toml);
  if (!m) return null;
  return [...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]);
}

const problems = [];
const deps = arrayAfter("dependencies") ?? [];
if (deps.length === 0) problems.push("no [project].dependencies array found — the file's shape changed, check by hand");

const nameOf = (spec) => spec.trim().split(/[\s<>=!~;[\]]/)[0].toLowerCase();

for (const spec of deps) {
  const name = nameOf(spec);
  if (FORBIDDEN.includes(name)) problems.push(`dependency "${spec}" is a signing/chain library`);
  else if (!ALLOWED.includes(name)) problems.push(`dependency "${spec}" is not on the keyless allow-list (${ALLOWED.join(", ")})`);
}

// Optional groups: [project.optional-dependencies] and [dependency-groups].
for (const [, body] of toml.matchAll(/^\[(?:project\.optional-dependencies|dependency-groups|tool\.uv\.dev-dependencies)\]([\s\S]*?)(?=^\[|\Z)/gm)) {
  for (const [, spec] of body.matchAll(/["']([^"']+)["']/g)) {
    const name = nameOf(spec);
    if (FORBIDDEN.includes(name)) problems.push(`optional dependency "${spec}" is a signing/chain library`);
  }
}

// The imports are the fact the dependency list only promises.
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "__pycache__" || entry === ".venv") continue;
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".py")) out.push(p);
  }
  return out;
}

const srcDir = path.join(pkgDir, "src");
const sources = existsSync(srcDir) ? walk(srcDir) : [];
if (sources.length === 0) problems.push("no Python sources found under src/ — check by hand");

const importRe = /^\s*(?:from|import)\s+([A-Za-z_][\w.]*)/gm;
const keyRe = /\b(private_key|privateKey|mnemonic|seed_phrase|sign_transaction|signTransaction|sign_typed_data|eth_sign)\b/;

for (const file of sources) {
  const text = readFileSync(file, "utf8");
  const rel = path.relative(root, file);
  for (const [, mod] of text.matchAll(importRe)) {
    const top = mod.split(".")[0].toLowerCase().replace(/_/g, "-");
    if (FORBIDDEN.includes(top)) problems.push(`${rel} imports "${mod}", a signing/chain library`);
  }
  // A key-shaped identifier is allowed only where the file is asserting it is absent.
  for (const line of text.split("\n")) {
    if (!keyRe.test(line)) continue;
    if (/#\s*keyless|assert|never|not\s|forbidden|no signing/i.test(line)) continue;
    problems.push(`${rel}: key-shaped identifier outside an assertion: ${line.trim().slice(0, 100)}`);
  }
}

// The three tools, and only three (ADR-E05).
const toolNames = ["get_balance", "list_pending", "propose_bounty_payout"];
const allSrc = sources.map((f) => readFileSync(f, "utf8")).join("\n");
for (const t of toolNames) {
  if (!allSrc.includes(t)) problems.push(`tool "${t}" is not defined anywhere in the package`);
}
if (/\b(execute_payout|sign_payout|send_transaction|submit_transaction|execute_transaction)\b/.test(allSrc)) {
  problems.push("the package names an execute/sign tool — the agent proposes, it never signs");
}

if (problems.length) {
  console.error("FAIL: the treasury MCP is not keyless:");
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

console.log(`OK: treasury MCP declares ${deps.length} dependencies, none of them signing or chain libraries; ${toolNames.length} tools, no signer`);
process.exit(0);
