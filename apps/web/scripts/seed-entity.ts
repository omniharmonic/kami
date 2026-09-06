/**
 * `pnpm --filter @kami/web seed:entity -- --slug boulder-creek …` — puts the
 * first entity into a fresh database.
 *
 * The summon flow (`/summon`) is the product path and creates entities the same
 * way; this exists because the first entity has no steward to summon it, and
 * because a fresh deployment should have something to show before anyone signs
 * in.
 *
 * It reads the checked-in profile — `profiles/<slug>/binding.yaml` and
 * `profiles/<slug>/voice.md` — validates the binding's *shape* against
 * `place-set-binding-1.0.json` (membership against the live tree is the
 * steward's job at freeze time, and this script never reaches the network),
 * and writes:
 *
 *   entities            one row, paused, not consulted unless you say otherwise
 *   entity_bindings     version 1, review `pending_review`, sha256 recorded
 *   souls               version 1, hard rules version from the template
 *   entity_events       `entity.seeded`, hash-chained like every other event
 *
 * Consultation is not faked. Without `--consultation <file>` the entity's page
 * 404s for the public (PRD §13 #4) and only role-holders see it; that is the
 * correct state for an entity nobody has consulted about yet. Pass the file
 * when a real conversation has happened and you want to record what was said.
 *
 * `--print-sql` writes the statements to stdout instead of executing them, for
 * the case where the database is reachable from somewhere your shell is not.
 * The SQL is exactly what the script would have run, in order, in one
 * transaction.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { assertBindingShape, bindingSha256, canonicalJson as bindingCanonicalJson, parseBinding } from "@kami/binding";
import { canonicalEventRow, eventHash } from "../src/db/events";
import { loadHardRules, VOICE_START, VOICE_END } from "../src/lib/summon/soul";

type Args = {
  slug: string;
  name?: string;
  archetype?: string;
  profileDir?: string;
  consultation?: string;
  stewardEmail?: string;
  printSql: boolean;
  paused: boolean;
};

function usage(message?: string): never {
  if (message) console.error(`seed-entity: ${message}\n`);
  console.error(
    [
      "usage: seed-entity --slug <slug> [options]",
      "",
      "  --slug <slug>            profile directory under profiles/ and the URL slug",
      "  --name <name>            display name (default: title-cased slug)",
      "  --archetype <kind>       creek|watershed|reservoir|mountain|bioregion (default: from the binding)",
      "  --profile-dir <path>     override profiles/<slug>",
      "  --consultation <file>    markdown record of the consultation; sets consultation_done_at",
      "  --steward-email <email>  grant the steward role to this user (must already exist)",
      "  --unpaused               create it running; the default is paused",
      "  --print-sql              print the SQL instead of executing it",
      "",
      "DATABASE_URL is required unless --print-sql is given.",
    ].join("\n"),
  );
  process.exit(2);
}

function parseArgs(argv: string[]): Args {
  const out: Args = { slug: "", printSql: false, paused: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i] ?? usage(`${a} needs a value`);
    switch (a) {
      case "--slug": out.slug = next(); break;
      case "--name": out.name = next(); break;
      case "--archetype": out.archetype = next(); break;
      case "--profile-dir": out.profileDir = next(); break;
      case "--consultation": out.consultation = next(); break;
      case "--steward-email": out.stewardEmail = next().toLowerCase(); break;
      case "--unpaused": out.paused = false; break;
      case "--print-sql": out.printSql = true; break;
      case "-h": case "--help": usage();
      default: usage(`unknown argument ${a}`);
    }
  }
  if (!out.slug) usage("--slug is required");
  if (!/^[a-z0-9-]+$/.test(out.slug)) usage("--slug must match [a-z0-9-]+ (it becomes entity/<slug>)");
  return out;
}

/** Repo root, walking up from this file — works from apps/web or the root. */
function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

function titleCase(slug: string): string {
  return slug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/** A SQL literal for a string, or NULL. Only ever used on values we authored. */
function lit(value: string | null | undefined): string {
  if (value === null || value === undefined) return "NULL";
  return `'${value.replace(/'/g, "''")}'`;
}

function extractVoice(soulOrVoice: string): string {
  const start = soulOrVoice.indexOf(VOICE_START);
  if (start === -1) return soulOrVoice.trim();
  const end = soulOrVoice.indexOf(VOICE_END, start);
  if (end === -1) throw new Error("voice block opens but never closes");
  return soulOrVoice.slice(start + VOICE_START.length, end).trim();
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const root = repoRoot();
  const dir = args.profileDir ? path.resolve(args.profileDir) : path.join(root, "profiles", args.slug);

  const bindingText = await readFile(path.join(dir, "binding.yaml"), "utf8");
  const binding = assertBindingShape(parseBinding(bindingText, "yaml"));
  const entityId = `entity/${args.slug}`;
  if (binding.entity_id !== entityId) {
    throw new Error(`binding.entity_id is ${binding.entity_id}, expected ${entityId}`);
  }

  const voice = extractVoice(await readFile(path.join(dir, "voice.md"), "utf8"));
  if (!voice) throw new Error(`${path.join(dir, "voice.md")} has no voice text`);
  const hardRules = await loadHardRules(path.join(root, "profiles", "templates", "SOUL.hard-rules.md"));

  const consultationMd = args.consultation ? await readFile(path.resolve(args.consultation), "utf8") : null;
  const name = args.name ?? titleCase(args.slug);
  const archetype = args.archetype ?? binding.archetype;
  const bindingJson = bindingCanonicalJson(binding);
  const sha = bindingSha256(binding);

  // The first event in an entity's chain: prev_hash is null by definition.
  const at = new Date();
  const payload = {
    slug: args.slug,
    binding_version: binding.binding_version,
    binding_sha256: sha,
    soul_version: 1,
    hard_rules_version: hardRules.version,
    paused: args.paused,
    consulted: consultationMd !== null,
    by: "scripts/seed-entity.ts",
  };
  const canonical = canonicalEventRow({ entity_id: entityId, at, actor: "seed", kind: "entity.seeded", payload, prev_hash: null });
  const hash = eventHash(null, canonical);

  const nowLit = lit(at.toISOString());
  const statements = [
    `INSERT INTO entities (id, slug, name, archetype, binding_version, soul_version, hermes_profile, ` +
      `consultation_md, consultation_done_at, paused_at, created_at) VALUES (` +
      `${lit(entityId)}, ${lit(args.slug)}, ${lit(name)}, ${lit(archetype)}::archetype, ` +
      `${binding.binding_version}, 1, ${lit(args.slug)}, ${lit(consultationMd)}, ` +
      `${consultationMd ? nowLit : "NULL"}, ${args.paused ? nowLit : "NULL"}, ${nowLit})`,
    `INSERT INTO entity_bindings (entity_id, binding_version, binding, sha256, review, created_at) VALUES (` +
      `${lit(entityId)}, ${binding.binding_version}, ${lit(bindingJson)}::jsonb, ${lit(sha)}, 'pending_review', ${nowLit})`,
    `INSERT INTO souls (entity_id, soul_version, hard_rules_version, voice_md, created_at) VALUES (` +
      `${lit(entityId)}, 1, ${lit(String(hardRules.version))}, ${lit(voice)}, ${nowLit})`,
    `INSERT INTO entity_events (entity_id, at, actor, kind, payload, prev_hash, hash) VALUES (` +
      `${lit(entityId)}, ${nowLit}, 'seed', 'entity.seeded', ${lit(JSON.stringify(payload))}::jsonb, NULL, ${lit(hash)})`,
  ];
  if (args.stewardEmail) {
    statements.push(
      `INSERT INTO entity_roles (entity_id, user_id, role, invited_at, accepted_at) ` +
        `SELECT ${lit(entityId)}, id, 'steward', ${nowLit}, ${nowLit} FROM users WHERE email = ${lit(args.stewardEmail)}`,
    );
  }

  if (args.printSql) {
    console.log("BEGIN;");
    for (const s of statements) console.log(`${s};`);
    console.log("COMMIT;");
    console.error(
      `\n-- ${entityId}: binding v${binding.binding_version} (${sha.slice(0, 12)}…), soul v1 ` +
        `(hard rules v${hardRules.version}), ${args.paused ? "paused" : "running"}, ` +
        `${consultationMd ? "consulted" : "not consulted — the page will 404 for the public"}`,
    );
    return;
  }

  const url = process.env.DATABASE_URL;
  if (!url) usage("DATABASE_URL is not set (or pass --print-sql)");
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const db = drizzle({ client: pool });
    await db.transaction(async (tx) => {
      for (const s of statements) await tx.execute(s as never);
    });
    console.log(
      `seeded ${entityId}: binding v${binding.binding_version}, soul v1, ` +
        `${args.paused ? "paused" : "running"}, ` +
        `${consultationMd ? "consulted" : "not consulted (page is 404 for the public until a steward records it)"}`,
    );
  } finally {
    await pool.end();
  }
}

await main();
