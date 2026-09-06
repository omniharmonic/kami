// @vitest-environment jsdom
/**
 * The link on the entity page. For the public it is not dimmed or disabled —
 * it is not there, because "connect a brain" is not something the public can
 * act on, and a visible-but-refusing control is a worse answer than silence.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

type User = { id: string; email: string; name: string | null; age_gate_ok: boolean; platform_admin: boolean };
let currentUser: User | null = null;

vi.mock("@/lib/session", async () => {
  const actual = await vi.importActual<typeof import("@/lib/session")>("@/lib/session");
  return { ...actual, getSession: async () => (currentUser ? { user: currentUser, expiresAt: new Date(Date.now() + 3_600_000) } : null) };
});

import * as schema from "@/db/schema";
import { setDbForTests } from "@/db/client";
import { closeTestDb, type TestDb } from "@/db/test-utils";
import { connectTestDb, seedConnectEntity } from "@/lib/connect/__tests__/helpers";
import { ConnectLink } from "../ConnectLink";

let db: TestDb;
const entity = { id: "entity/boulder-creek", slug: "boulder-creek", created_by: "u-maya" };

beforeEach(async () => {
  db = await connectTestDb();
  setDbForTests(db);
  await seedConnectEntity(db, "boulder-creek");
  await db.insert(schema.entityRoles).values({ entityId: entity.id, userId: "u-ada", role: "guardian", acceptedAt: new Date() });
});

afterEach(async () => {
  cleanup();
  currentUser = null;
  setDbForTests(null);
  await closeTestDb(db);
});

describe("ConnectLink", () => {
  it("is absent for the public and for a signed-in stranger", async () => {
    currentUser = null;
    expect(await ConnectLink({ entity })).toBeNull();
    currentUser = { id: "u-nobody", email: "nobody@example.org", name: null, age_gate_ok: true, platform_admin: false };
    expect(await ConnectLink({ entity })).toBeNull();
  });

  it("is there for the creator and for a guardian, and points at the connect page", async () => {
    currentUser = { id: "u-maya", email: "maya@example.org", name: "Maya", age_gate_ok: true, platform_admin: false };
    render(await ConnectLink({ entity }));
    expect(screen.getByTestId("connect-link").querySelector("a")!.getAttribute("href")).toBe("/e/boulder-creek/connect");
    cleanup();
    currentUser = { id: "u-ada", email: "ada@example.org", name: "Ada", age_gate_ok: true, platform_admin: false };
    render(await ConnectLink({ entity }));
    expect(screen.getByTestId("connect-link").textContent).toContain("Connect a brain");
  });
});
