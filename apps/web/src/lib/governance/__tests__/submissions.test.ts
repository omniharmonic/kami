/**
 * The upload → finalize path (T2.8) against PGlite and an in-memory object
 * store: sha256 is re-verified from the stored bytes, EXIF is parsed with
 * `exifr`, the files are checked against the bounty's `evidence_spec`, and the
 * bounty moves to `in_review` with an `evidence_summary` the model may see.
 */
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { listEntityEvents } from "@/db/events";
import { buildExifJpeg, buildPlainJpeg, ORODELL } from "@/lib/evidence/__tests__/fixtures";
import type { EvidenceStorage } from "@/lib/evidence/storage";
import { claimBounty } from "../claims";
import { finalizeSubmission, requestEvidenceDeletion } from "../submissions";
import { closeTestDb, createTestDb, freshContributor, openBounty, seedWorld, type TestDb, type World } from "./helpers";

let db: TestDb;
let w: World;

/** An object store that lives in a Map, so no R2 and no filesystem are touched. */
function memoryStorage(): EvidenceStorage & { objects: Map<string, Buffer> } {
  const objects = new Map<string, Buffer>();
  return {
    kind: "local",
    objects,
    async presignPut(key) {
      return { url: `memory://${key}`, method: "PUT", headers: {}, expires_at: new Date(Date.now() + 60_000).toISOString() };
    },
    async getObject(key) {
      return objects.get(key) ?? null;
    },
    async deleteObject(key) {
      objects.delete(key);
    },
  };
}

async function stage(store: ReturnType<typeof memoryStorage>, claimId: string, bytes: Buffer, opts: { inApp?: boolean; sha?: string; id?: string } = {}) {
  const id = opts.id ?? `ev_${Math.random().toString(16).slice(2, 10)}`;
  const key = `evidence/${w.slug}/${claimId}/${id}.jpg`;
  store.objects.set(key, bytes);
  await db.insert(schema.evidenceFiles).values({
    id,
    r2Key: key,
    sha256: opts.sha ?? createHash("sha256").update(bytes).digest("hex"),
    mime: "image/jpeg",
    bytes: bytes.byteLength,
    inAppCapture: opts.inApp ?? true,
    licenceAcceptedAt: new Date(),
  });
  return { id, key };
}

const goodPhoto = () => buildExifJpeg({ dateTime: "2026:09:05 10:30:00", lat: ORODELL.lat, lon: ORODELL.lon });
const farPhoto = () => buildExifJpeg({ dateTime: "2026:09:05 11:30:00", lat: ORODELL.lat + 0.05, lon: ORODELL.lon });

beforeAll(async () => {
  db = await createTestDb();
  w = await seedWorld(db);
  // A binding whose anchor centroid is the Orodell reach, for the GPS check.
  await db.insert(schema.entityBindings).values({
    entityId: w.entityId,
    bindingVersion: 1,
    binding: { anchor: "place/boulder-creek-near-orodell-co", anchor_centroid: ORODELL },
    sha256: "0".repeat(64),
    review: "approved",
  });
});
afterAll(async () => {
  await closeTestDb(db);
});

describe("finalizeSubmission", () => {
  it("builds the submission, meets the spec, and moves the bounty to in_review", async () => {
    const store = memoryStorage();
    const b = await openBounty(w);
    const c = await freshContributor(db);
    const { claim } = await claimBounty(db, b.id, c);
    await stage(store, claim.id, goodPhoto());
    await stage(store, claim.id, goodPhoto());

    const res = await finalizeSubmission(db, { bounty_id: b.id, user_id: c, note: "walked the reach https://example.com/x" }, { storage: store });
    expect(res.spec_check).toEqual({ ok: true, failures: [] });
    expect(res.bounty_status).toBe("in_review");
    expect(res.summary).toMatchObject({ photo_count: 2, exif_ok_count: 2, gps_within_spec_count: 2, in_app_capture_count: 2 });
    expect(res.summary.note, "the URL never reaches the model").toBe("walked the reach");

    const files = await db.select().from(schema.evidenceFiles).where(eq(schema.evidenceFiles.submissionId, res.submission_id));
    expect(files).toHaveLength(2);
    expect(files[0]!.capturedAt).not.toBeNull();
    expect(Number(files[0]!.gpsLat)).toBeCloseTo(ORODELL.lat, 3);
    expect((await listEntityEvents(db, w.entityId)).map((e) => e.kind)).toContain("evidence_submitted");
  });

  it("records the spec failures when a photo is outside gps_within_m", async () => {
    const store = memoryStorage();
    const b = await openBounty(w);
    const c = await freshContributor(db);
    const { claim } = await claimBounty(db, b.id, c);
    await stage(store, claim.id, goodPhoto());
    await stage(store, claim.id, farPhoto());

    const res = await finalizeSubmission(db, { bounty_id: b.id, user_id: c }, { storage: store });
    expect(res.spec_check.ok).toBe(false);
    expect(res.spec_check.failures.join(" ")).toMatch(/more than 50 m from the place/);
    expect(res.summary.gps_within_spec_count).toBe(1);
    // the evidence is still recorded; the evaluator decides what it is worth
    expect(res.bounty_status).toBe("in_review");
  });

  it("records the spec failure when EXIF is missing and the spec requires it", async () => {
    const store = memoryStorage();
    const b = await openBounty(w);
    const c = await freshContributor(db);
    const { claim } = await claimBounty(db, b.id, c);
    await stage(store, claim.id, goodPhoto());
    await stage(store, claim.id, buildPlainJpeg());
    const res = await finalizeSubmission(db, { bounty_id: b.id, user_id: c }, { storage: store });
    expect(res.spec_check.failures.join(" ")).toMatch(/without EXIF capture time/);
    expect(res.summary.exif_ok_count).toBe(1);
  });

  it("refuses a file whose bytes do not match the sha256 the client supplied", async () => {
    const store = memoryStorage();
    const b = await openBounty(w);
    const c = await freshContributor(db);
    const { claim } = await claimBounty(db, b.id, c);
    await stage(store, claim.id, goodPhoto(), { sha: "f".repeat(64) });
    await expect(finalizeSubmission(db, { bounty_id: b.id, user_id: c }, { storage: store })).rejects.toThrow(/sha_mismatch/);
  });

  it("refuses to finalize with no staged files, and refuses someone with no active claim", async () => {
    const store = memoryStorage();
    const b = await openBounty(w);
    const c = await freshContributor(db);
    await claimBounty(db, b.id, c);
    await expect(finalizeSubmission(db, { bounty_id: b.id, user_id: c }, { storage: store })).rejects.toThrow(/no_files/);
    const stranger = await freshContributor(db);
    await expect(finalizeSubmission(db, { bounty_id: b.id, user_id: stranger }, { storage: store })).rejects.toThrow(/no_claim/);
  });

  it("refuses to finalize while the kami is paused", async () => {
    const store = memoryStorage();
    const b = await openBounty(w);
    const c = await freshContributor(db);
    const { claim } = await claimBounty(db, b.id, c);
    await stage(store, claim.id, goodPhoto());
    await db.update(schema.entities).set({ pausedAt: new Date() }).where(eq(schema.entities.id, w.entityId));
    await expect(finalizeSubmission(db, { bounty_id: b.id, user_id: c }, { storage: store })).rejects.toThrow(/paused/);
    await db.update(schema.entities).set({ pausedAt: null }).where(eq(schema.entities.id, w.entityId));
  });

  it("marks files not captured in the app, so the spec check can refuse them", async () => {
    const store = memoryStorage();
    const b = await openBounty(w);
    const c = await freshContributor(db);
    const { claim } = await claimBounty(db, b.id, c);
    await stage(store, claim.id, goodPhoto(), { inApp: false });
    await stage(store, claim.id, goodPhoto(), { inApp: false });
    const res = await finalizeSubmission(db, { bounty_id: b.id, user_id: c }, { storage: store });
    expect(res.summary.in_app_capture_count).toBe(0);
    expect(res.spec_check.failures.join(" ")).toMatch(/not captured in the app/);
  });
});

describe("evidence deletion on request (PRD §13 #7)", () => {
  it("deletes the file but keeps its hash on record", async () => {
    const store = memoryStorage();
    const b = await openBounty(w);
    const c = await freshContributor(db);
    const { claim } = await claimBounty(db, b.id, c);
    const staged = await stage(store, claim.id, goodPhoto());
    await stage(store, claim.id, goodPhoto());
    const res = await finalizeSubmission(db, { bounty_id: b.id, user_id: c }, { storage: store });
    expect(res.files).toBe(2);

    const out = await requestEvidenceDeletion(db, c, { storage: store });
    expect(out.deleted).toBe(2);
    expect(store.objects.get(staged.key)).toBeUndefined();
    const [row] = await db.select().from(schema.evidenceFiles).where(eq(schema.evidenceFiles.id, staged.id));
    expect(row!.deletedAt).not.toBeNull();
    expect(row!.sha256, "the hash stays because an attestation may reference it").toHaveLength(64);
    const ev = (await listEntityEvents(db, w.entityId)).filter((e) => e.kind === "evidence_deleted");
    expect(ev.length).toBeGreaterThan(0);
  });
});
