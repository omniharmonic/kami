// @vitest-environment jsdom
/**
 * PRD §13 #4: an entity's page is not public until a steward has recorded that
 * the consultation happened.
 *
 * The bug this guards, found on the first live deployment: the gate lived only
 * in the layout, and **a layout's `notFound()` does not stop the page from
 * rendering.** `GET /e/boulder-creek` answered 404 while its response body
 * carried the page's whole RSC payload — the chat heading, the board, the
 * treasury, and the People section, which names the entity's guardians. The
 * status code was right and the data still left the building.
 *
 * So the assertion here is not "it throws". It is: an unconsulted entity's page
 * component must refuse *before* it reads anything about the entity, in every
 * segment under /e/[slug] that renders entity content. A test that only checked
 * for a thrown 404 would have passed against the broken build.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup } from "@testing-library/react";
import { setDbForTests } from "@/db/client";
import * as schema from "@/db/schema";
import { closeTestDb, createTestDb, seedEntity, seedUser, type TestDb } from "@/db/test-utils";
import EntityPage from "../page";
import ChatPage from "../chat/page";
import DonatePage from "../donate/page";
import ProposalsPage from "../proposals/page";
import EntityLayout from "../layout";

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

const params = (slug: string) => Promise.resolve({ slug });
const searchParams = Promise.resolve({});

/** Next's `notFound()` throws; this is what a 404 looks like from inside. */
async function isNotFound(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch (err) {
    return String((err as { digest?: string }).digest ?? err).includes("NEXT_HTTP_ERROR_FALLBACK;404");
  }
}

describe("the consultation gate", () => {
  it("refuses every segment of an unconsulted entity, not just the layout", async () => {
    await seedEntity(db, { slug: "unconsulted", name: "Unconsulted Creek", consultationDone: false });

    // The layout is the gate everyone remembers.
    expect(await isNotFound(() => EntityLayout({ params: params("unconsulted"), children: null }))).toBe(true);

    // These are the ones that leaked: each renders entity content of its own and
    // each must refuse on its own, because they render concurrently with the
    // layout rather than after it.
    expect(await isNotFound(() => EntityPage({ params: params("unconsulted") }))).toBe(true);
    expect(await isNotFound(() => ChatPage({ params: params("unconsulted") }))).toBe(true);
    expect(await isNotFound(() => DonatePage({ params: params("unconsulted"), searchParams }))).toBe(true);
    expect(await isNotFound(() => ProposalsPage({ params: params("unconsulted"), searchParams }))).toBe(true);
  });

  it("does not put the entity's people into a refused render", async () => {
    const entity = await seedEntity(db, { slug: "private-creek", name: "Private Creek", consultationDone: false });
    const guardian = await seedUser(db, "gwen", "gwen@example.org");
    await db
      .insert(schema.entityRoles)
      .values({ entityId: entity.id, userId: guardian.id, role: "guardian", acceptedAt: new Date() });

    // No session, so no preview: the page must throw rather than return a tree.
    // If it ever returns one, serializing it is what put guardian names on the
    // wire behind a 404.
    let rendered: unknown = null;
    try {
      rendered = await EntityPage({ params: params("private-creek") });
    } catch {
      /* expected */
    }
    expect(rendered).toBeNull();
  });

  it("still serves an entity whose consultation is recorded", async () => {
    await seedEntity(db, { slug: "open-creek", name: "Open Creek" });
    expect(await isNotFound(() => EntityPage({ params: params("open-creek") }))).toBe(false);
    expect(await isNotFound(() => EntityLayout({ params: params("open-creek"), children: null }))).toBe(false);
  });
});
