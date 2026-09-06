// @vitest-environment jsdom
/**
 * `/admin` shows each kami's serving provenance and how old the report is, so
 * an operator can see at a glance that a box is reporting what they think it is
 * — the same reported facts the public page renders, never an assertion.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/lib/session", async () => {
  const actual = await vi.importActual<typeof import("@/lib/session")>("@/lib/session");
  return {
    ...actual,
    getSession: async () => null,
    requireAdmin: async () => ({ id: "u-admin", email: "admin@example.org", name: null, age_gate_ok: true, platform_admin: true }),
  };
});

import { setDbForTests } from "@/db/client";
import * as schema from "@/db/schema";
import { closeTestDb, createTestDb, seedEntity, type TestDb } from "@/db/test-utils";
import AdminPage from "../page";

let db: TestDb;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

beforeEach(async () => {
  db = await createTestDb();
  setDbForTests(db);
});

afterEach(async () => {
  cleanup();
  setDbForTests(null);
  await closeTestDb(db);
});

async function renderAdmin() {
  return render(await AdminPage({ searchParams: Promise.resolve({}) }));
}

describe("/admin — serving provenance", () => {
  it("shows placement, provider, model and the report's age", async () => {
    await seedEntity(db, { slug: "hosted-creek", name: "Hosted Creek" });
    await db.insert(schema.config).values({
      key: "gate_provenance.hosted-creek",
      value: { placement: "hosted", provider: "together.ai", model: "qwen3.5-9b", at: iso(2 * 3_600_000) },
    });
    await renderAdmin();
    const cell = screen.getByTestId("serving-hosted-creek").textContent!;
    expect(cell).toContain("hosted");
    expect(cell).toContain("together.ai");
    expect(cell).toContain("qwen3.5-9b");
    expect(cell).toContain("2 h ago");
    expect(cell).toContain("gate");
  });

  it("says nothing was reported rather than showing a plausible default", async () => {
    await seedEntity(db, { slug: "silent-creek", name: "Silent Creek" });
    await renderAdmin();
    expect(screen.getByTestId("serving-silent-creek").textContent).toContain("nothing reported");
  });

  it("marks a stale report so an operator sees a box that has gone quiet", async () => {
    await seedEntity(db, { slug: "stale-creek", name: "Stale Creek" });
    await db.insert(schema.config).values({
      key: "gate_provenance.stale-creek",
      value: { placement: "owned", provider: "the box", model: "qwen3.5-9b", at: iso(30 * 3_600_000) },
    });
    await renderAdmin();
    const cell = screen.getByTestId("serving-stale-creek");
    expect(cell.querySelector(".chip-stale")).toBeTruthy();
    expect(cell.textContent).toContain("30 h ago");
  });
});
