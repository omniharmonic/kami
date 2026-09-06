/**
 * The soul, step 3 (PRD §4.5, §6.2).
 *
 * Two halves, and only one of them is writable:
 *
 * - **hard rules** — read from `profiles/templates/SOUL.hard-rules.md` on the
 *   server, rendered read-only, and never accepted from a client. There is no
 *   code path in this app that writes them. `souls.hard_rules_version` records
 *   which version an entity was created under.
 * - **voice block** — at most three sentences, validated with exactly the
 *   rules `profiles/scripts/src/lib/soul.ts` and
 *   `profiles/templates/soul_render.py` apply, so what the creator sees
 *   accepted here is what the deploy script will render. The golden file
 *   `profiles/boulder-creek/SOUL.md` pins all three implementations together
 *   (see `__tests__/soul.test.ts`).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

export const VOICE_START = "<!-- kami:voice start -->";
export const VOICE_END = "<!-- kami:voice end -->";
export const MAX_VOICE_SENTENCES = 3;
export const MAX_VOICE_CHARS = 1200;
const FORBIDDEN_IN_VOICE = ["kami:hard-rules", "kami:voice"] as const;
const FENCE_RE = /<!-- kami:hard-rules v(\d+) start -->\n([\s\S]*?)<!-- kami:hard-rules v\1 end -->\n?/;
const SENTENCE_SPLIT_RE = /(?<=[.!?])\s+/;

export class VoiceBlockError extends Error {
  override name = "VoiceBlockError";
  constructor(
    public readonly code: "empty" | "too_long" | "fence" | "too_many_chars",
    message: string,
  ) {
    super(message);
  }
}
export class HardRulesError extends Error {
  override name = "HardRulesError";
}

export type HardRules = { version: number; block: string; path: string };

const TEMPLATE_REL = path.join("profiles", "templates", "SOUL.hard-rules.md");

/**
 * Where the checked-in template lives. `KAMI_HARD_RULES_PATH` wins (Vercel
 * traces only what it is told to; see the work-package report for the
 * `outputFileTracingIncludes` line this needs). Otherwise the repo root is
 * found by walking up from the working directory, so `apps/web`, the repo
 * root and a test runner all resolve to the same file.
 */
export function hardRulesCandidates(cwd: string = process.cwd()): string[] {
  const fromEnv = process.env.KAMI_HARD_RULES_PATH;
  const out = fromEnv ? [fromEnv] : [];
  let dir = path.resolve(cwd);
  for (let i = 0; i < 6; i++) {
    out.push(path.join(dir, TEMPLATE_REL));
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return out;
}

export function hardRulesPath(cwd?: string): string {
  return hardRulesCandidates(cwd)[0]!;
}

export function extractHardRules(text: string): { version: number; block: string } {
  const m = FENCE_RE.exec(text);
  if (!m) throw new HardRulesError("no <!-- kami:hard-rules vN start --> … end fence found");
  const version = Number(m[1]);
  return { version, block: `<!-- kami:hard-rules v${version} start -->\n${m[2]}<!-- kami:hard-rules v${version} end -->\n` };
}

let cached: HardRules | null = null;

/** The locked block, byte-identical to the template's fenced region. Cached per process. */
export async function loadHardRules(file?: string): Promise<HardRules> {
  const candidates = file ? [file] : hardRulesCandidates();
  if (cached && candidates.includes(cached.path)) return cached;
  const tried: string[] = [];
  for (const candidate of candidates) {
    let text: string;
    try {
      text = await readFile(candidate, "utf8");
    } catch {
      tried.push(candidate);
      continue;
    }
    const { version, block } = extractHardRules(text);
    cached = { version, block, path: candidate };
    return cached;
  }
  throw new HardRulesError(`the hard-rules template is not readable; tried ${tried.join(", ")}`);
}

export function resetHardRulesCacheForTests(): void {
  cached = null;
}

export function countSentences(voice: string): number {
  return voice
    .trim()
    .split(SENTENCE_SPLIT_RE)
    .filter((p) => p.trim().length > 0).length;
}

/**
 * The same three refusals `profiles/scripts` applies — empty, a fence marker,
 * more than three sentences — plus a length cap so a single unpunctuated
 * paragraph cannot smuggle a soul past the sentence count.
 */
export function validateVoice(voice: string): string {
  const stripped = voice.trim();
  if (!stripped) throw new VoiceBlockError("empty", "voice block is empty");
  for (const marker of FORBIDDEN_IN_VOICE) {
    if (stripped.includes(marker)) throw new VoiceBlockError("fence", `voice block may not contain the fence marker '${marker}'`);
  }
  const n = countSentences(stripped);
  if (n > MAX_VOICE_SENTENCES) throw new VoiceBlockError("too_long", `voice block has ${n} sentences; the limit is ${MAX_VOICE_SENTENCES} (PRD §4.5)`);
  if (stripped.length > MAX_VOICE_CHARS) throw new VoiceBlockError("too_many_chars", `voice block is ${stripped.length} characters; the limit is ${MAX_VOICE_CHARS}`);
  return stripped;
}

export function footer(slug: string): string {
  return (
    `<!-- Rendered by profiles/scripts/deploy-profile.ts from profiles/templates/SOUL.hard-rules.md` +
    ` + profiles/${slug}/voice.md. Edit voice.md (Steward role); never edit this file. -->\n`
  );
}

/** Byte-identical to `renderSoul` in `profiles/scripts/src/lib/soul.ts`. */
export function renderSoul(hardRulesBlock: string, voice: string, slug: string): string {
  const v = validateVoice(voice);
  return `${hardRulesBlock}\n${VOICE_START}\n# Voice\n\n${v}\n${VOICE_END}\n\n${footer(slug)}`;
}

/** The whole SOUL.md for an entity, hard rules read from the template on the server. */
export async function renderSoulFor(slug: string, voice: string, file?: string): Promise<{ soul: string; hard_rules_version: number }> {
  const rules = await loadHardRules(file);
  return { soul: renderSoul(rules.block, voice, slug), hard_rules_version: rules.version };
}
