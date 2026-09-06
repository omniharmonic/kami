// @vitest-environment jsdom
/**
 * `/e/[slug]/connect` — the page a creator lands on.
 *
 * The two properties asserted here are the ones a screenshot cannot check:
 *
 *  - somebody without a role on this kami does not get a 403 or an empty page,
 *    they get sent to the public page, which is the page they meant;
 *  - the token is never in the page's own HTML. It exists only in the reply to
 *    the click that minted it, so a page rendered after minting shows a
 *    fingerprint and an age and nothing else.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

class Redirected extends Error {
  constructor(public readonly to: string) {
    super(`redirect ${to}`);
  }
}

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
  notFound: () => {
    throw new Redirected("/404");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "kami.test", "x-forwarded-proto": "https" }),
}));

type User = { id: string; email: string; name: string | null; age_gate_ok: boolean; platform_admin: boolean };
let currentUser: User | null = null;

vi.mock("@/lib/session", async () => {
  const actual = await vi.importActual<typeof import("@/lib/session")>("@/lib/session");
  return { ...actual, getSession: async () => (currentUser ? { user: currentUser, expiresAt: new Date(Date.now() + 3_600_000) } : null) };
});

import * as schema from "@/db/schema";
import { setDbForTests } from "@/db/client";
import { closeTestDb, type TestDb } from "@/db/test-utils";
import { mintConnectToken } from "@/lib/connect/token";
import { connectTestDb, seedConnectEntity } from "@/lib/connect/__tests__/helpers";
import ConnectPage from "../page";

const maya: User = { id: "u-maya", email: "maya@example.org", name: "Maya", age_gate_ok: true, platform_admin: false };
const nobody: User = { id: "u-nobody", email: "nobody@example.org", name: null, age_gate_ok: true, platform_admin: false };

let db: TestDb;

beforeEach(async () => {
  db = await connectTestDb();
  setDbForTests(db);
  await seedConnectEntity(db, "boulder-creek");
  // Maya is the steward; she also created it.
  await db.insert(schema.entityRoles).values({ entityId: "entity/boulder-creek", userId: "u-maya", role: "steward", acceptedAt: new Date() });
  currentUser = maya;
});

afterEach(async () => {
  cleanup();
  currentUser = null;
  setDbForTests(null);
  await closeTestDb(db);
});

async function renderPage(slug = "boulder-creek") {
  return render(await ConnectPage({ params: Promise.resolve({ slug }) }));
}

describe("/e/[slug]/connect", () => {
  it("sends someone without a role to the public page rather than refusing them", async () => {
    currentUser = nobody;
    await expect(ConnectPage({ params: Promise.resolve({ slug: "boulder-creek" }) })).rejects.toMatchObject({ to: "/e/boulder-creek" });
  });

  it("sends a signed-out visitor to the public page too", async () => {
    currentUser = null;
    await expect(ConnectPage({ params: Promise.resolve({ slug: "boulder-creek" }) })).rejects.toMatchObject({ to: "/e/boulder-creek" });
  });

  it("answers the first question: the endpoint, the slug and the header", async () => {
    await renderPage();
    expect(screen.getByTestId("mcp-endpoint").textContent).toBe("https://kami.test/mcp");
    expect(screen.getByTestId("entity-slug").textContent).toBe("boulder-creek");
    expect(screen.getByTestId("auth-header").textContent).toContain("Bearer ${PLATFORM_MCP_TOKEN}");
  });

  it("lists both tool registries, with the write tools marked", async () => {
    const { container } = await renderPage();
    expect(container.querySelector('[data-testid="tools-platform"] [data-tool="get_needs_snapshot"][data-writes="false"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="tools-platform"] [data-tool="post_update"][data-writes="true"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="tools-twin"] [data-tool="get_entity_status"][data-writes="false"]')).not.toBeNull();
  });

  it("renders the locked hard rules and the voice block, and lists the bundle's files", async () => {
    const { container } = await renderPage();
    expect(screen.getByTestId("hard-rules").textContent).toContain("Hard rules");
    expect(screen.getByTestId("voice-block").textContent).toContain("You speak for this creek plainly");
    for (const file of ["SOUL.md", "binding.json", "mcp.json", "README.md", "skills/entity-steward/SKILL.md"]) {
      expect(container.querySelector(`[data-file="${CSS.escape(file)}"]`), file).not.toBeNull();
    }
    expect(screen.getByTestId("mcp-json").textContent).toContain("kami-platform");
  });

  it("shows both connection paths, with the generic one first and selected", async () => {
    await renderPage();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Any MCP client", "Hermes"]);
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("config-yaml").textContent).toContain("base_url: http");
    expect(screen.getByTestId("cron-jobs").textContent).toContain("pulse");
    expect(screen.getByTestId("hermes-commands").textContent).toContain("deploy-profile boulder-creek");
  });

  it("never renders an existing token's value — only its prefix, fingerprint and age", async () => {
    const minted = await mintConnectToken(db, { id: "entity/boulder-creek", slug: "boulder-creek" }, "u-maya");
    const { container } = await renderPage();
    expect(container.innerHTML).not.toContain(minted.token);
    expect(container.innerHTML).not.toMatch(/kami_[a-z0-9-]+_[0-9a-f]{48}/);
    expect(screen.getByTestId("token-facts").textContent).toContain("kami_boulder-creek_…");
    expect(screen.getByTestId("token-facts").textContent).toContain(minted.state.fingerprint!);
    // and the destructive action is offered as a rotation, not as another mint
    expect(screen.getByTestId("rotate-start")).toBeTruthy();
  });

  it("offers minting, not a token, when none has been minted", async () => {
    await renderPage();
    expect(screen.getByTestId("token-none").textContent).toContain("No bearer token has been minted");
    expect(screen.getByTestId("mint")).toBeTruthy();
    expect(screen.queryByTestId("rotate-start")).toBeNull();
  });

  it("lets a guardian read the page but not mint", async () => {
    await db.insert(schema.entityRoles).values({ entityId: "entity/boulder-creek", userId: "u-ada", role: "guardian", acceptedAt: new Date() });
    currentUser = { id: "u-ada", email: "ada@example.org", name: "Ada", age_gate_ok: true, platform_admin: false };
    await renderPage();
    expect(screen.getByTestId("token-cannot-mint")).toBeTruthy();
    expect(screen.queryByTestId("mint")).toBeNull();
    expect(screen.getByTestId("role-line").textContent).toContain("guardian role");
  });

  it("renders the status section with every signal, and no bare tick", async () => {
    const { container } = await renderPage();
    const signals = [...container.querySelectorAll("[data-signal]")].map((n) => n.getAttribute("data-signal"));
    expect(signals).toEqual(["token", "mcp_call", "mcp_tool", "pulse", "gate", "chat"]);
    expect(screen.getByTestId("state-token").textContent).toBe("not set up");
    expect(screen.getByTestId("connect-status").textContent).toContain("Mint one above");
  });
});
