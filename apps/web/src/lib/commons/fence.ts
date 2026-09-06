/**
 * The fence pattern, ported from the twin (`twin/commons/stub.py:10-11,
 * 135-145`; survey §7.3) with Kami's markers. `splice` replaces ONLY the
 * region between the markers and prepends the block when they are absent;
 * everything outside the fence is byte-identical afterwards — that is what
 * lets a human's prose below the markers survive every sync run.
 */
export const BEGIN = "<!-- kami:auto begin -->";
export const END = "<!-- kami:auto end -->";

/** The generated block wrapped in its markers, trailing newline included. */
export function wrap(block: string): string {
  return `${BEGIN}\n${block.replace(/\s+$/, "")}\n${END}\n`;
}

/** Replace the fenced region of `existing` with `block`; prepend when no fence exists. */
export function splice(existing: string | null | undefined, block: string): string {
  const fenced = wrap(block);
  if (!existing) return fenced;
  const start = existing.indexOf(BEGIN);
  const end = existing.indexOf(END, start >= 0 ? start : 0);
  if (start === -1 || end === -1) return `${fenced}\n${existing}`;
  const after = end + END.length;
  // Keep exactly what followed the old END marker (including its newline, if any).
  const tail = existing.slice(after);
  const head = existing.slice(0, start);
  return `${head}${fenced.replace(/\n$/, "")}${tail}`;
}

/** The current fenced block (without markers), or null when the note has no fence. */
export function fencedBlock(content: string | null | undefined): string | null {
  if (!content) return null;
  const start = content.indexOf(BEGIN);
  const end = content.indexOf(END, start);
  if (start === -1 || end === -1) return null;
  return content.slice(start + BEGIN.length, end).replace(/^\n/, "").replace(/\n$/, "");
}

/** Everything outside the fence — the part that belongs to humans. */
export function outsideFence(content: string | null | undefined): string {
  if (!content) return "";
  const start = content.indexOf(BEGIN);
  const end = content.indexOf(END, start);
  if (start === -1 || end === -1) return content;
  return content.slice(0, start) + content.slice(end + END.length);
}
