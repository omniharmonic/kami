// @vitest-environment jsdom
/**
 * The "how I work" page must report its own machinery, never assert it.
 *
 * The bug this guards: the page used to carry the hardcoded sentence "A small
 * open-weights language model running on a single rented GPU … No frontier
 * model is on the hot path." The day an operator points the gate at a hosted,
 * OpenAI-compatible API — which is exactly what happens while the project's own
 * box is pending — that sentence becomes a lie told by the page whose entire job
 * is to be checkable. So: the claim may appear only when the gate has recently
 * reported that the weights run on a GPU this project owns or rents.
 *
 * G7 (PRD §3) also requires this page to name the model, the guard, and the
 * guardians. All three are asserted below, in every provenance case.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { setDbForTests } from "@/db/client";
import * as schema from "@/db/schema";
import { closeTestDb, createTestDb, seedEntity, seedUser, type TestDb } from "@/db/test-utils";
import HowIWorkPage from "../page";

const FRONTIER_CLAIM = "No frontier model is on the hot path";
const HOUR = 3_600_000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
  setDbForTests(db);
});

afterEach(async () => {
  cleanup();
  setDbForTests(null);
  await closeTestDb(db);
});

/** Seed one kami with two guardians (G7) and, optionally, a gate report. */
async function seed(slug: string, name: string, provenance?: unknown) {
  const entity = await seedEntity(db, { slug, name });
  for (const g of ["ada", "grace"]) {
    const u = await seedUser(db, `${slug}-${g}`, `${slug}-${g}@example.org`);
    await db.insert(schema.entityRoles).values({ entityId: entity.id, userId: u.id, role: "guardian", acceptedAt: new Date() });
  }
  if (provenance !== undefined) {
    await db.insert(schema.config).values({ key: `gate_provenance.${slug}`, value: provenance as object });
  }
  return entity;
}

async function renderPage(slug: string) {
  const page = await HowIWorkPage({ params: Promise.resolve({ slug }) });
  return render(page);
}

describe("/e/[slug]/how-i-work — the model section reports, it does not assert", () => {
  it("names the provider and the consequence when a hosted API is answering, and drops the frontier claim", async () => {
    // "no-profile" so nothing on disk can rescue the page: only the gate speaks.
    await seed("hosted-creek", "Hosted Creek", { placement: "hosted", provider: "together.ai", model: "Qwen3.5-9B-Instruct", at: iso(2 * 60_000) });
    const { container } = await renderPage("hosted-creek");

    expect(screen.getByTestId("model-name").textContent).toContain("Qwen3.5-9B-Instruct");
    const placement = screen.getByTestId("model-placement").textContent!;
    expect(placement).toContain("together.ai");
    expect(placement).toContain("not on hardware this project controls");
    // What it means for the reader: the conversation leaves our machines.
    expect(placement).toMatch(/What you type is sent to together\.ai/);
    // …and the guard still applies either way.
    expect(screen.getByTestId("model-guard").textContent).toContain("checks every sentence");
    expect(container.textContent).not.toContain(FRONTIER_CLAIM);
  });

  it("makes the frontier claim when — and only when — the gate says the GPU is ours", async () => {
    await seed("owned-creek", "Owned Creek", { placement: "owned", provider: "the box in Nederland", model: "qwen3.5-9b", at: iso(60_000) });
    const { container } = await renderPage("owned-creek");
    expect(screen.getByTestId("model-placement").textContent).toContain("hardware this project controls");
    expect(container.textContent).toContain(FRONTIER_CLAIM);
    expect(screen.getByTestId("model-guard")).toBeTruthy();
  });

  it("makes the frontier claim for a rented GPU too, naming who it is rented from", async () => {
    await seed("rented-creek", "Rented Creek", { placement: "rented", provider: "RunPod", model: "qwen3.5-9b", at: iso(60_000) });
    const { container } = await renderPage("rented-creek");
    expect(screen.getByTestId("model-placement").textContent).toContain("RunPod");
    expect(container.textContent).toContain(FRONTIER_CLAIM);
  });

  it("says it does not know when nothing has reported, and claims nothing at all", async () => {
    await seed("silent-creek", "Silent Creek");
    const { container } = await renderPage("silent-creek");
    const said = screen.getByTestId("model-name").textContent!;
    expect(said).toContain("does not know and will not guess");
    expect(container.textContent).not.toContain(FRONTIER_CLAIM);
    // No placement sentence at all — not a hedge, not a default.
    expect(screen.queryByTestId("model-placement")).toBeNull();
    expect(screen.queryByTestId("model-reported")).toBeNull();
  });

  it("renders a 30-hour-old report as last-known, with its timestamp, and withholds the claim", async () => {
    const at = iso(30 * HOUR);
    await seed("stale-creek", "Stale Creek", { placement: "owned", provider: "the box in Nederland", model: "qwen3.5-9b", at });
    const { container } = await renderPage("stale-creek");
    const reported = screen.getByTestId("model-reported");
    expect(reported.getAttribute("data-stale")).toBe("true");
    expect(reported.textContent).toContain(at);
    expect(reported.textContent).toContain("30 h ago");
    expect(reported.textContent).toContain("not a statement about what is running right now");
    expect(screen.getByTestId("model-placement").textContent).toContain("When it last reported");
    expect(container.textContent).not.toContain(FRONTIER_CLAIM);
  });

  it("shows a fresh report's timestamp without the last-known framing", async () => {
    const at = iso(2 * HOUR);
    await seed("fresh-creek", "Fresh Creek", { placement: "hosted", provider: "together.ai", model: "qwen3.5-9b", at });
    const reported = (await renderPage("fresh-creek")).getByTestId("model-reported");
    expect(reported.getAttribute("data-stale")).toBe("false");
    expect(reported.textContent).toContain(at);
    expect(reported.textContent).not.toContain("Last reported");
  });

  it("uses the gate's report over the profile on disk, and the profile only when the gate is silent", async () => {
    // boulder-creek is the one kami with a real Hermes profile in profiles/.
    await seed("boulder-creek", "Boulder Creek");
    const fromProfile = (await renderPage("boulder-creek")).container.textContent!;
    expect(fromProfile).toContain("qwen3.5-9b");
    expect(fromProfile).toContain("a request, not a measurement");
    expect(fromProfile).not.toContain(FRONTIER_CLAIM);
    cleanup();

    await db.insert(schema.config).values({
      key: "gate_provenance.boulder-creek",
      value: { placement: "hosted", provider: "together.ai", model: "gpt-oss-120b", at: iso(60_000) },
    });
    const fromGate = (await renderPage("boulder-creek")).container.textContent!;
    expect(fromGate).toContain("gpt-oss-120b");
    expect(fromGate).toContain("together.ai");
    expect(fromGate).not.toContain("a request, not a measurement");
    expect(fromGate).not.toContain(FRONTIER_CLAIM);
  });

  /**
   * The regression guard for the exact bug being fixed: across every shape of
   * provenance, the page may carry the frontier claim only when a fresh gate
   * report puts the weights on a GPU this project owns or rents.
   */
  it("never carries the frontier claim unless a fresh report says owned or rented", async () => {
    const cases: Array<{ slug: string; report?: unknown; allowed: boolean }> = [
      { slug: "case-owned", report: { placement: "owned", provider: "the box", model: "m", at: iso(60_000) }, allowed: true },
      { slug: "case-rented", report: { placement: "rented", provider: "RunPod", model: "m", at: iso(60_000) }, allowed: true },
      { slug: "case-hosted", report: { placement: "hosted", provider: "together.ai", model: "m", at: iso(60_000) }, allowed: false },
      { slug: "case-hosted-anon", report: { placement: "hosted", model: "m", at: iso(60_000) }, allowed: false },
      { slug: "case-no-placement", report: { model: "m", at: iso(60_000) }, allowed: false },
      { slug: "case-stale-owned", report: { placement: "owned", provider: "the box", model: "m", at: iso(30 * HOUR) }, allowed: false },
      { slug: "case-stale-rented", report: { placement: "rented", provider: "RunPod", model: "m", at: iso(48 * HOUR) }, allowed: false },
      { slug: "case-garbage", report: { placement: "wherever" }, allowed: false },
      { slug: "case-unknown", allowed: false },
    ];
    for (const c of cases) {
      await seed(c.slug, c.slug, c.report);
      const { container } = await renderPage(c.slug);
      const claimed = container.textContent!.includes(FRONTIER_CLAIM);
      expect(claimed, `${c.slug} claimed=${claimed}`).toBe(c.allowed);
      cleanup();
    }
  });
});

describe("/e/[slug]/how-i-work — G7: model, guard, guardians", () => {
  it("names all three in every provenance case", async () => {
    const cases: Array<[string, unknown | undefined]> = [
      ["g7-hosted", { placement: "hosted", provider: "together.ai", model: "qwen3.5-9b", at: iso(60_000) }],
      ["g7-owned", { placement: "owned", provider: "the box", model: "qwen3.5-9b", at: iso(60_000) }],
      ["g7-unknown", undefined],
    ];
    for (const [slug, report] of cases) {
      await seed(slug, slug, report);
      const { container } = await renderPage(slug);
      // Model
      expect(screen.getByRole("heading", { name: "Model" })).toBeTruthy();
      expect(screen.getByTestId("model-name")).toBeTruthy();
      // Guard
      expect(screen.getByRole("heading", { name: "The guard" })).toBeTruthy();
      expect(container.textContent).toContain("Every number I utter must match a value");
      // Guardians — the people who can stop this
      expect(screen.getByRole("heading", { name: "Guardians" })).toBeTruthy();
      const names = screen.getByTestId("guardian-names").textContent!;
      expect(names).toContain(`${slug}-ada`);
      expect(names).toContain(`${slug}-grace`);
      cleanup();
    }
  });
});
