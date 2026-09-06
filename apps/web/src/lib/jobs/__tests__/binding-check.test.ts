import { afterAll, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { desc, eq } from "drizzle-orm";
import type { Binding } from "@kami/binding";
import { closeTestDb, type TestDb } from "@/db/test-utils";
import * as schema from "@/db/schema";
import { verifyEventChain } from "@/db/events";
import { runBindingCheck } from "../binding-check";
import { runVerifyChain } from "../verify-chain";
import { getConfig } from "../common";
import { runNeedsJob } from "../needs";
import { cleanupTmpDirs, copyFixtureTree, NOW, readPublishedStatus, seedBoulderCreek, twinFromFixtures } from "./helpers";

// Each case builds a fresh PGlite database and runs every migration; on a box
// running several suites at once that can outlast the shared 60 s default.
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });


const dbs: TestDb[] = [];
afterAll(async () => {
  await Promise.all(dbs.map((d) => closeTestDb(d)));
  await cleanupTmpDirs();
});

/** Mark a place page superseded, as the twin does for a retired gauge (survey §3.5). */
async function supersede(dir: string, id: string, successor: string): Promise<void> {
  const file = path.join(dir, "latest", `${id}.json`);
  const page = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
  page.superseded_by = successor;
  await fs.writeFile(file, JSON.stringify(page), "utf8");
}

describe("the nightly binding check", () => {
  it("reports a member the tree does not publish as `missing`, and does not re-record unchanged findings", async () => {
    const { db, entity } = await seedBoulderCreek({ slug: "clean-creek" });
    dbs.push(db);
    const twin = twinFromFixtures();
    const first = await runBindingCheck({ db, twin, now: NOW });
    // `place/union-reservoir` is in the committed binding but not in the fixture tree
    // (docs/verify.md #33: the reservoir slugs are guesses until checked against the live tree).
    expect(first[0]).toMatchObject({ slug: "clean-creek", status: "findings", changed: true });
    expect(first[0]!.findings).toEqual([{ id: "place/union-reservoir", role: "reservoir", state: "missing", needs: [] }]);
    expect(await getConfig(db, "binding_findings.clean-creek")).toEqual(first[0]!.findings);
    // a missing member with no successor drafts nothing — a steward is paged instead
    expect(await db.select().from(schema.entityBindings).where(eq(schema.entityBindings.entityId, entity.id))).toHaveLength(1);
    const events = await db.select().from(schema.entityEvents).where(eq(schema.entityEvents.entityId, entity.id));
    // the first run records the (empty) findings once; a second identical run adds nothing
    await runBindingCheck({ db, twin: twinFromFixtures(), now: NOW });
    const after = await db.select().from(schema.entityEvents).where(eq(schema.entityEvents.entityId, entity.id));
    expect(after).toHaveLength(events.length);
    expect(events.map((e) => e.kind)).toEqual(["binding.findings"]);
  });

  it("drafts a pending_review successor binding and marks the need superseded in the next status file", async () => {
    const { db, entity, publisher } = await seedBoulderCreek({ slug: "superseded-creek" });
    dbs.push(db);
    const tree = await copyFixtureTree();
    await supersede(tree, "place/boulder-creek-near-orodell-co", "place/boulder-creek-co-near-orodell");

    const out = await runBindingCheck({ db, twin: twinFromFixtures(tree), now: NOW });
    expect(out[0]).toMatchObject({ slug: "superseded-creek", status: "drafted", draft_version: 2 });
    expect(out[0]!.findings![0]).toMatchObject({ id: "place/boulder-creek-near-orodell-co", state: "stale", reason: "superseded", successor: "place/boulder-creek-co-near-orodell" });

    const drafts = await db.select().from(schema.entityBindings).where(eq(schema.entityBindings.entityId, entity.id)).orderBy(desc(schema.entityBindings.bindingVersion));
    expect(drafts[0]).toMatchObject({ bindingVersion: 2, review: "pending_review" });
    const draft = drafts[0]!.binding as Binding;
    expect(draft.anchor).toBe("place/boulder-creek-co-near-orodell");
    expect(draft.needs.find((n) => n.need === "flow")!.places).toEqual(["place/boulder-creek-co-near-orodell"]);
    // the entity still points at the approved version until a steward acts
    const [row] = await db.select().from(schema.entities).where(eq(schema.entities.id, entity.id));
    expect(row!.bindingVersion).toBe(1);

    // the audit chain records it
    const events = await db.select().from(schema.entityEvents).where(eq(schema.entityEvents.entityId, entity.id));
    expect(events.map((e) => e.kind)).toContain("binding.supersession_drafted");
    expect(await verifyEventChain(db, entity.id)).toMatchObject({ ok: true });

    // the next status.json carries the templated superseded line, not a model's words
    await runNeedsJob({ db, twin: twinFromFixtures(tree), publisher, now: NOW, gpuOnline: true });
    const file = (await readPublishedStatus(publisher, "superseded-creek"))!;
    const superseded = file.superseded as Array<Record<string, unknown>>;
    expect(superseded.length).toBeGreaterThan(0);
    expect(superseded[0]).toMatchObject({ need: "flow", state: "stale", successor: "place/boulder-creek-co-near-orodell", line: "one of my gauges was retired; my stewards are updating my body" });

    // a second nightly run does not draft the same version twice
    const again = await runBindingCheck({ db, twin: twinFromFixtures(tree), now: NOW });
    expect(again[0]).toMatchObject({ status: "findings", draft_version: 2 });
    expect(await db.select().from(schema.entityBindings).where(eq(schema.entityBindings.entityId, entity.id))).toHaveLength(2);
  });
});

describe("the nightly chain verification", () => {
  it("writes the head hash into config for status.json", async () => {
    const { db, entity, publisher } = await seedBoulderCreek({ slug: "chain-creek" });
    dbs.push(db);
    await runBindingCheck({ db, twin: twinFromFixtures(), now: NOW }); // one event to chain
    const heads = await runVerifyChain(db, NOW);
    const head = heads.find((h) => h.slug === "chain-creek")!;
    expect(head.ok).toBe(true);
    expect(head.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await getConfig(db, "event_chain_head.chain-creek")).toMatchObject({ ok: true, hash: head.hash });

    await runNeedsJob({ db, twin: twinFromFixtures(), publisher, now: NOW, gpuOnline: true });
    const file = (await readPublishedStatus(publisher, "chain-creek"))!;
    expect(file.event_chain_head).toBe(head.hash);
    expect(entity.id).toBe("entity/chain-creek");
  });
});
