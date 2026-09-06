/**
 * Asking the entity for the report's paragraph over the real HTTP shape.
 * The rule: an unguarded number is never published, so anything short of a
 * clean guarded answer produces the template.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { makeFakeDeps, type FakeDeps } from "@/lib/treasury/__tests__/fakes";
import { askEntityForParagraph } from "../gate";
import { buildFactSheet, type ReportData } from "../donor-report";

let deps: FakeDeps;
const NOW = new Date("2026-10-01T06:00:00.000Z");

const DATA: ReportData = {
  entity: { id: "entity/boulder-creek", slug: "boulder-creek", name: "Boulder Creek", archetype: "creek", safe_address: "0x1111111111111111111111111111111111111111", chain_id: 84532 },
  month: "2026-09-01",
  month_label: "September 2026",
  balance: { usdc: "100.00", as_of: NOW.toISOString() },
  inflows: [{ rail: "card", count: 2, gross_usd: "30.00", fee_usd: "1.47", net_usd: "28.53" }],
  inflow_totals: { count: 2, gross_usd: "30.00", fee_usd: "1.47", net_usd: "28.53" },
  payouts: [],
  payout_total_usd: "0.00",
  as_of: NOW.toISOString(),
};

function input() {
  return { slug: "boulder-creek", name: "Boulder Creek", month: "2026-09-01", factSheet: buildFactSheet(DATA), data: DATA };
}

function fakeFetch(res: { status?: number; guard?: string | null; body?: unknown; throws?: boolean }) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    if (res.throws) throw new Error("tunnel down");
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (res.guard) headers["x-guard"] = res.guard;
    return new Response(JSON.stringify(res.body ?? {}), { status: res.status ?? 200, headers });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const answer = (text: string) => ({ choices: [{ message: { role: "assistant", content: text } }] });

beforeEach(() => {
  deps = makeFakeDeps({ now: NOW });
});

describe("askEntityForParagraph", () => {
  it("sends the fact sheet as a tool message AFTER the last user message, where the guard looks for it", async () => {
    const f = fakeFetch({ guard: "ok", body: answer("Thirty dollars came in during September.") });
    await askEntityForParagraph({ ...deps, fetchImpl: f.impl }, input(), "http://gw.test:8642");

    expect(f.calls[0]!.url).toBe("http://gw.test:8642/p/boulder-creek/v1/chat/completions");
    const body = JSON.parse(String(f.calls[0]!.init.body)) as { stream: boolean; messages: Array<{ role: string; content: string }> };
    expect(body.stream).toBe(false);
    const roles = body.messages.map((m) => m.role);
    expect(roles).toEqual(["system", "user", "tool"]);
    expect(roles.lastIndexOf("tool")).toBeGreaterThan(roles.lastIndexOf("user"));
    const sheet = JSON.parse(body.messages[2]!.content) as { schema_version: string; atoms: unknown[] };
    expect(sheet.schema_version).toBe("1.0");
    expect(sheet.atoms.length).toBeGreaterThan(0);
    expect((f.calls[0]!.init.headers as Record<string, string>)["x-kami-job"]).toBe("cron");
  });

  it("uses the entity's words when the guard passes", async () => {
    const f = fakeFetch({ guard: "ok", body: answer("Thirty dollars came in during September.") });
    expect(await askEntityForParagraph({ ...deps, fetchImpl: f.impl }, input(), "http://gw.test")).toMatchObject({
      source: "entity",
      guard: "pass",
      text: "Thirty dollars came in during September.",
    });
  });

  it("swaps in the template on X-Guard: held", async () => {
    const f = fakeFetch({ guard: "held", body: answer("The creek rose by nine hundred feet.") });
    const r = await askEntityForParagraph({ ...deps, fetchImpl: f.impl }, input(), "http://gw.test");
    expect(r).toMatchObject({ source: "template", guard: "held", reason: "held" });
    expect(r.text).toContain("$30.00");
    expect(r.text).not.toContain("nine hundred");
  });

  it("honours kami_guard in the body over the header", async () => {
    const f = fakeFetch({ guard: "ok", body: { ...answer("something"), kami_guard: { status: "held", violations: ["900"] } } });
    expect(await askEntityForParagraph({ ...deps, fetchImpl: f.impl }, input(), "http://gw.test")).toMatchObject({ source: "template", guard: "held" });
  });

  it("templates on a tunnel error, a pause, an over-budget gate, a 500 and an empty answer", async () => {
    const cases: Array<[Parameters<typeof fakeFetch>[0], string]> = [
      [{ throws: true }, "tunnel_error"],
      [{ status: 423 }, "paused"],
      [{ status: 429 }, "over_budget"],
      [{ status: 500 }, "http_error"],
      [{ status: 200, body: { choices: [] } }, "empty"],
    ];
    for (const [res, reason] of cases) {
      const f = fakeFetch(res);
      const r = await askEntityForParagraph({ ...deps, fetchImpl: f.impl }, input(), "http://gw.test");
      expect(r.source, `${reason} should template`).toBe("template");
      expect(r.reason).toBe(reason);
    }
  });

  it("the fake gateway modes work without a network, for dev and for tests", async () => {
    expect(await askEntityForParagraph(deps, input(), "fake:")).toMatchObject({ source: "entity", guard: "pass" });
    expect(await askEntityForParagraph(deps, input(), "fake:held")).toMatchObject({ source: "template", guard: "held" });
    expect(await askEntityForParagraph(deps, input(), "fake:asleep")).toMatchObject({ source: "template", reason: "tunnel_error" });
  });
});
