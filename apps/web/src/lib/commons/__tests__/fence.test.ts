import { describe, expect, it } from "vitest";
import { BEGIN, END, fencedBlock, outsideFence, splice, wrap } from "../fence";
import { MemoryNoteStore, upsertNote } from "../sync";
import { tkSafe, safeExcerpt } from "../tk-safe";
import { commonsLink, shelfPathFor, watershedShelfPath, absoluteNoteUrl } from "../links";
import { encodeNotePath } from "../client";
import type { NoteSpec } from "../templates";

describe("the fence", () => {
  it("prepends the block when the note has no markers", () => {
    const out = splice("Human prose.\n", "generated");
    expect(out.startsWith(BEGIN)).toBe(true);
    expect(out).toContain("Human prose.");
    expect(fencedBlock(out)).toBe("generated");
  });

  it("replaces only the fenced region", () => {
    const first = splice(null, "v1");
    const withHuman = `${first}\n## My notes\n\nThe creek was loud today.\n`;
    const second = splice(withHuman, "v2");
    expect(fencedBlock(second)).toBe("v2");
    expect(outsideFence(second)).toBe(outsideFence(withHuman));
    expect(second).toContain("The creek was loud today.");
  });

  it("keeps a human edit below the fence byte-identical over 100 sync runs", async () => {
    const store = new MemoryNoteStore();
    const spec = (n: number): NoteSpec => ({
      path: "entities/boulder-creek",
      kind: "page",
      tags: ["entity", "entity/page"],
      metadata: { place_id: "place/boulder-creek-near-orodell-co", run: n },
      block: `# Boulder Creek\n\nrun ${n}`,
    });
    await upsertNote(store, spec(0));
    const human = "\n## From the neighbours\n\nWe cleared the diversion on Tuesday. — A.\n";
    store.humanEdit("entities/boulder-creek", (c) => c + human);

    for (let i = 1; i <= 100; i++) {
      const r = await upsertNote(store, spec(i));
      expect(r.action, `run ${i}`).not.toBe("failed");
    }
    const note = (await store.getNote("entities/boulder-creek"))!;
    expect(note.content.endsWith(human)).toBe(true);
    expect(fencedBlock(note.content)).toBe("# Boulder Creek\n\nrun 100");
    expect(note.content.split(BEGIN)).toHaveLength(2);
    expect(note.content.split(END)).toHaveLength(2);
    // tags are set at create only (survey §7.5)
    expect(note.tags).toEqual(["entity", "entity/page"]);
  });

  it("writes nothing when neither the block nor the metadata changed", async () => {
    const store = new MemoryNoteStore();
    const spec: NoteSpec = { path: "entities/x", kind: "page", tags: ["entity"], metadata: { a: 1 }, block: "same" };
    expect((await upsertNote(store, spec)).action).toBe("created");
    const writes = store.writes;
    expect((await upsertNote(store, spec)).action).toBe("unchanged");
    expect(store.writes).toBe(writes);
  });

  it("re-splices and retries once when the note changed underneath (409/412)", async () => {
    const store = new MemoryNoteStore();
    const spec: NoteSpec = { path: "entities/y", kind: "page", tags: ["entity"], metadata: { v: 1 }, block: "one" };
    await upsertNote(store, spec);
    const racing: typeof store = Object.create(store);
    let patched = 0;
    (racing as unknown as { patchNote: typeof store.patchNote }).patchNote = async (path, input) => {
      if (patched++ === 0) {
        store.humanEdit(path, (c) => `${c}\nlate human line\n`); // makes if_updated_at stale
      }
      return store.patchNote(path, input);
    };
    (racing as unknown as { getNote: typeof store.getNote }).getNote = (p) => store.getNote(p);
    (racing as unknown as { createNote: typeof store.createNote }).createNote = (i) => store.createNote(i);
    const r = await upsertNote(racing, { ...spec, block: "two", metadata: { v: 2 } });
    expect(r.action).toBe("updated");
    const note = (await store.getNote("entities/y"))!;
    expect(fencedBlock(note.content)).toBe("two");
    expect(note.content).toContain("late human line");
  });

  it("wraps a block with a trailing newline and no leading blank", () => {
    expect(wrap("x")).toBe(`${BEGIN}\nx\n${END}\n`);
  });
});

describe("TK / BC safety", () => {
  const base = { path: "wiki/places/named/x", content: "Some prose about a place that is long enough to be an excerpt of its own.", tags: ["commons-seed"], updated_at: null };

  it("passes a public note", () => {
    expect(tkSafe({ ...base, metadata: { sensitivity: "public", place_id: "place/x" } }).ok).toBe(true);
  });

  it("refuses a note carrying TK or BC labels", () => {
    expect(tkSafe({ ...base, metadata: { tk_labels: ["TK A"] } })).toMatchObject({ ok: false });
    expect(tkSafe({ ...base, metadata: { local_contexts: { labels: ["BC Provenance"] } } })).toMatchObject({ ok: false });
    expect(tkSafe({ ...base, metadata: { notes: "carries a TK Attribution label" } })).toMatchObject({ ok: false });
    expect(tkSafe({ ...base, metadata: { indigenous_governed: true } })).toMatchObject({ ok: false, reason: "indigenous_governed" });
    expect(tkSafe({ ...base, metadata: {}, tags: ["tk/seasonal"] })).toMatchObject({ ok: false });
    expect(tkSafe({ ...base, metadata: { sensitivity: "restricted" } })).toMatchObject({ ok: false });
  });

  it("never returns an excerpt of a TK-labelled note", () => {
    expect(safeExcerpt({ ...base, metadata: { tk_labels: ["TK S"] } })).toBeNull();
    const ok = safeExcerpt({ ...base, metadata: { sensitivity: "public" } });
    expect(ok).toContain("Some prose about a place");
  });

  it("strips links and wikilinks from an excerpt", () => {
    const note = { ...base, metadata: {}, content: "See [[wiki/places/named/boulder-creek|Boulder Creek]] and https://example.org/page for the long form of this note." };
    expect(safeExcerpt(note)).toBe("See Boulder Creek and for the long form of this note.");
  });
});

describe("commons links", () => {
  it("maps a watershed id to the front-range shelf path and an absolute fallback", () => {
    expect(watershedShelfPath("watershed/huc10-1019000504")).toBe("wiki/places/watersheds/huc1019000504");
    expect(shelfPathFor("place/niwot")).toBe("wiki/places/monitoring/niwot");
    expect(absoluteNoteUrl("wiki/places/watersheds/huc1019000504")).toBe("https://prism.omniharmonic.com/p/front-range/notes/wiki%2Fplaces%2Fwatersheds%2Fhuc1019000504");
    expect(commonsLink("watershed/huc10-1019000504")).toBe("[[wiki/places/watersheds/huc1019000504]] (https://prism.omniharmonic.com/p/front-range/notes/wiki%2Fplaces%2Fwatersheds%2Fhuc1019000504)");
  });
  it("percent-encodes a note path as one segment", () => {
    expect(encodeNotePath("entities/boulder-creek/state/2026-W37")).toBe("entities%2Fboulder-creek%2Fstate%2F2026-W37");
  });
});
