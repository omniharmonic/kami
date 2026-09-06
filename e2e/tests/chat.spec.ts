import { expect, test } from "@playwright/test";
import { BASE_URL } from "../ports";
import { COPY, FAKE_SENTENCES, FAKE_TOOLCALL, NAME, SLUG, reply, sendTurn, sendTurnAndWait, testIp, useFreshIp } from "./helpers";

/**
 * T1.5 / ADR-E13 — one chat turn against the fake gateway.
 *
 * Asserted: the reply arrives sentence by sentence (not in one lump), the
 * "what I looked at" footer lists place id, time, source and the stale flag for
 * every tool call, reply nodes carry `data-generated="ai"` (EU AI Act Art. 50
 * marking, §11), and the SB 243 reminder is rendered by the app — never by the
 * model — every `config.reminder_every_turns` turns (default 12).
 */

declare global {
  interface Window {
    __kamiSnaps?: string[];
  }
}

test.describe("chat", () => {
  test.beforeEach(async ({ page }) => {
    await useFreshIp(page);
    await page.goto(`/e/${SLUG}/chat`);
  });

  test("streams the reply sentence by sentence, one frame at a time, over the app's own relay", async () => {
    // Measured on the wire, with `accept-encoding: identity`. See the skipped
    // test below for why a browser cannot observe the gaps that are here.
    const t0 = Date.now();
    const res = await fetch(`${BASE_URL}/e/${SLUG}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream", "accept-encoding": "identity", "x-forwarded-for": testIp() },
      body: JSON.stringify({ messages: [{ role: "user", content: "How is the creek today?" }] }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const arrivals = await readSse(res, t0);

    expect(arrivals.map((a) => a.text.trim())).toEqual(FAKE_SENTENCES);
    // Each sentence lands in its own frame at its own time — not one lump.
    // The fake gateway spaces them 40 ms apart, so the span from first to last
    // is at least 40 ms (exactly 40 when the reader keeps up perfectly; more
    // under load). Asserting `> 40` was off by one against the fixture itself.
    expect(arrivals[arrivals.length - 1]!.at - arrivals[0]!.at, `frame arrival times: ${arrivals.map((a) => a.at).join(", ")} ms`).toBeGreaterThanOrEqual(40);
  });

  test("still streams under gzip, which is what every browser actually asks for", async () => {
    // Next gzips text/event-stream by default, which buffers the whole reply
    // and destroys sentence-by-sentence release. The relay sets
    // `cache-control: no-transform`, which its compression middleware honours.
    // This test is the regression guard: without that header the three frames
    // arrive together and the span collapses to a few milliseconds.
    const t0 = Date.now();
    const res = await fetch(`${BASE_URL}/e/${SLUG}/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        "accept-encoding": "gzip, deflate, br",
        "x-forwarded-for": testIp(),
      },
      body: JSON.stringify({ messages: [{ role: "user", content: "How is the creek today?" }] }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control") ?? "").toContain("no-transform");

    const arrivals = await readSse(res, t0);
    expect(arrivals.map((a) => a.text.trim())).toEqual(FAKE_SENTENCES);
    expect(
      arrivals[arrivals.length - 1]!.at - arrivals[0]!.at,
      `frame arrival times under gzip: ${arrivals.map((a) => a.at).join(", ")} ms`,
    ).toBeGreaterThanOrEqual(40);
  });

  test("renders the streamed sentences into the reply, in order and only ever appended", async ({ page }) => {
    // A MutationObserver records every intermediate render of the reply node, so
    // this does not depend on sampling the DOM fast enough. The browser normally
    // sees one render, not three, because the response is gzipped and therefore
    // buffered — see the skipped test above.
    await page.evaluate(() => {
      window.__kamiSnaps = [];
      const root = document.querySelector(".chat");
      if (!root) throw new Error("no .chat root");
      new MutationObserver(() => {
        const node = document.querySelector('[data-generated="ai"] p');
        const text = node?.textContent ?? "";
        if (text && window.__kamiSnaps![window.__kamiSnaps!.length - 1] !== text) window.__kamiSnaps!.push(text);
      }).observe(root, { subtree: true, childList: true, characterData: true });
    });

    await sendTurnAndWait(page, "How is the creek today?");

    const snaps = (await page.evaluate(() => window.__kamiSnaps ?? [])).filter((s) => s !== "Listening…");
    expect(snaps.length, "the reply never rendered").toBeGreaterThanOrEqual(1);
    // Every state is a prefix of the next — text is appended, never rewritten,
    // so a reader never sees a sentence retracted.
    for (let i = 1; i < snaps.length; i++) {
      expect(snaps[i]!.startsWith(snaps[i - 1]!), `"${snaps[i - 1]}" is not a prefix of "${snaps[i]}"`).toBe(true);
    }
    // The sentences land in the order the gateway sent them.
    expect(snaps[snaps.length - 1]!.trim()).toBe(FAKE_SENTENCES.join(" "));
    for (const sentence of FAKE_SENTENCES) await expect(reply(page)).toContainText(sentence);
    // The footer is only written once the stream has finished.
    await expect(reply(page).locator("[data-looked-at]")).toBeVisible();
  });

  test("renders the 'what I looked at' footer with place id, time, source and stale flag", async ({ page }) => {
    await sendTurnAndWait(page, "What did you look at?");
    const footer = reply(page).locator("[data-looked-at]");
    await expect(footer).toContainText(COPY.lookedAt);

    for (const placeId of FAKE_TOOLCALL.placeIds) await expect(footer).toContainText(placeId);
    for (const time of FAKE_TOOLCALL.times) await expect(footer).toContainText(time);
    await expect(footer).toContainText(FAKE_TOOLCALL.sourceId);

    // The stale flag is a word, never a colour: the stale call says "can't feel
    // it", the fresh one says "live" (X.5, ADR-E11).
    await expect(footer).toContainText(COPY.cantFeelIt);
    await expect(footer).toContainText("live");
    // …and the source status travels with it.
    await expect(footer).toContainText("critical");
    await expect(footer).toContainText("ok");
    expect(await footer.locator("li").count()).toBe(FAKE_TOOLCALL.placeIds.length);
  });

  test('marks reply nodes data-generated="ai"', async ({ page }) => {
    await sendTurnAndWait(page, "Are you a person?");
    const nodes = page.locator('[data-generated="ai"]');
    await expect(nodes).toHaveCount(1);
    await expect(nodes.first()).toHaveAttribute("aria-label", "AI-generated");
    // The message the human typed is not marked as generated.
    await expect(page.locator('.msg-user[data-generated="ai"]')).toHaveCount(0);
  });

  test("renders the SB 243 reminder as a system message on the 12th turn, not before", async ({ page }) => {
    // `config.reminder_every_turns` defaults to 12 and there is no database here
    // to override it, so 12 turns is the boundary under test. The fake gateway
    // answers in ~120 ms, so the full count is cheap; nothing is stubbed.
    const reminder = page.getByText(COPY.reminder);

    for (let turn = 1; turn <= 12; turn++) {
      await sendTurnAndWait(page, `turn ${turn}`, turn - 1);
      if (turn < 12) {
        await expect(reminder, `the reminder must not appear on turn ${turn}`).toHaveCount(0);
      }
    }

    await expect(reminder).toHaveCount(1);
    await expect(reminder).toBeVisible();
    await expect(reminder).toContainText(`not a person and not ${NAME} itself`);
    // It is a system message, not a reply: it is never marked as generated text.
    await expect(page.locator('[data-generated="ai"]').filter({ hasText: COPY.reminder })).toHaveCount(0);
  });

  test("the reminder is counted by the app, not the model: the gateway stream carries no reminder text", async ({ request }) => {
    // The same 12 turns at the protocol level would double the IP budget, so
    // this asserts the complementary half: one turn of the raw SSE stream
    // contains only the model's sentences and the toolcalls event.
    const res = await request.post(`/e/${SLUG}/chat`, {
      headers: { "content-type": "application/json", accept: "text/event-stream", "x-forwarded-for": testIp() },
      data: { messages: [{ role: "user", content: "one raw turn" }] },
    });
    expect(res.status()).toBe(200);
    expect(res.headers()["x-kami-state"]).toBe("ok");
    const body = await res.text();
    expect(body).toContain("event: toolcalls");
    expect(body).not.toContain(COPY.reminder);
    // Sentence-by-sentence on the wire: one `data:` frame per sentence.
    const contentFrames = body.split("\n\n").filter((f) => f.startsWith("data: ") && f.includes('"content":"') && !f.includes('"content":""'));
    expect(contentFrames.length).toBe(FAKE_SENTENCES.length);
  });

  test("a turn from the entity home page renders the same footer", async ({ page }) => {
    await page.goto(`/e/${SLUG}`);

    await sendTurn(page, "hello from the home page");
    await expect(reply(page).locator("[data-looked-at]")).toBeVisible({ timeout: 20_000 });
    await expect(reply(page)).toHaveAttribute("data-generated", "ai");
  });
});

/** Read an SSE response to the end, timestamping every content delta. */
async function readSse(res: Response, t0: number): Promise<Array<{ at: number; text: string }>> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  const arrivals: Array<{ at: number; text: string }> = [];
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const m = /"content":"((?:[^"\\]|\\.)*)"/.exec(frame);
      if (m && m[1]) arrivals.push({ at: Date.now() - t0, text: JSON.parse(`"${m[1]}"`) as string });
    }
  }
  return arrivals;
}
