/**
 * SOUL.md rendering — the TypeScript twin of profiles/templates/soul_render.py.
 * Both must produce byte-identical output; profiles/boulder-creek/SOUL.md is the shared golden.
 *
 * Layout: hard-rules block (verbatim, fences included) · blank · voice fence · blank · constant footer.
 */

export const VOICE_START = "<!-- kami:voice start -->";
export const VOICE_END = "<!-- kami:voice end -->";
export const MAX_VOICE_SENTENCES = 3;
const FORBIDDEN_IN_VOICE = ["kami:hard-rules", "kami:voice"];
const FENCE_RE = /<!-- kami:hard-rules v(\d+) start -->\n([\s\S]*?)<!-- kami:hard-rules v\1 end -->\n?/;
const SENTENCE_SPLIT_RE = /(?<=[.!?])\s+/;

export class VoiceBlockError extends Error {
  override name = "VoiceBlockError";
}
export class HardRulesError extends Error {
  override name = "HardRulesError";
}

export type HardRules = { version: number; block: string };

/** Find the fenced block; the result includes both fence lines and a trailing newline. */
export function extractHardRules(text: string): HardRules {
  const m = FENCE_RE.exec(text);
  if (!m) throw new HardRulesError("no <!-- kami:hard-rules vN start --> … end fence found");
  const version = Number(m[1]);
  const block = `<!-- kami:hard-rules v${version} start -->\n${m[2]}<!-- kami:hard-rules v${version} end -->\n`;
  return { version, block };
}

export function countSentences(voice: string): number {
  return voice
    .trim()
    .split(SENTENCE_SPLIT_RE)
    .filter((p) => p.trim().length > 0).length;
}

export function validateVoice(voice: string): string {
  const stripped = voice.trim();
  if (!stripped) throw new VoiceBlockError("voice block is empty");
  for (const marker of FORBIDDEN_IN_VOICE) {
    if (stripped.includes(marker)) {
      throw new VoiceBlockError(`voice block may not contain the fence marker '${marker}'`);
    }
  }
  const n = countSentences(stripped);
  if (n > MAX_VOICE_SENTENCES) {
    throw new VoiceBlockError(`voice block has ${n} sentences; the limit is ${MAX_VOICE_SENTENCES} (PRD §4.5)`);
  }
  return stripped;
}

export function footer(slug: string): string {
  return (
    `<!-- Rendered by profiles/scripts/deploy-profile.ts from profiles/templates/SOUL.hard-rules.md` +
    ` + profiles/${slug}/voice.md. Edit voice.md (Steward role); never edit this file. -->\n`
  );
}

export function renderSoul(hardRulesTemplate: string, voice: string, slug: string): string {
  const { block } = extractHardRules(hardRulesTemplate);
  const v = validateVoice(voice);
  return `${block}\n${VOICE_START}\n# Voice\n\n${v}\n${VOICE_END}\n\n${footer(slug)}`;
}

/** Swap the fenced block of an existing SOUL.md for the template's; leave the voice and footer alone. */
export function replaceHardRules(existingSoul: string, newTemplate: string): string {
  const { block } = extractHardRules(newTemplate);
  const m = FENCE_RE.exec(existingSoul);
  if (!m) throw new HardRulesError("existing SOUL.md has no hard-rules fence to replace");
  return existingSoul.slice(0, m.index) + block + existingSoul.slice(m.index + m[0].length);
}
