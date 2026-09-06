import { expect, test } from "@playwright/test";
import { COPY, SLUG, reply, sendTurn, testIp, useFreshIp } from "./helpers";

/**
 * T1.5 (e) / ADR-E12 / G8 — pause is enforced outside the model.
 *
 * This file runs against the second server, whose `HERMES_GATEWAY_URL` is
 * `fake:paused`: the gate refuses every completion with 423. The web app relays
 * that as 423 `{reason:"paused"}` and the UI says so in words. Nothing the model
 * could have said is rendered, because nothing was generated.
 *
 * The other pause point — `entities.paused_at`, which makes the route answer 423
 * before the gateway is called at all — needs a database row and is covered by
 * `apps/web`'s unit tests; here the gate is the one under test.
 */

test.describe("paused by its guardians", () => {
  test("the chat route answers 423", async ({ request }) => {
    const res = await request.post(`/e/${SLUG}/chat`, {
      headers: { "content-type": "application/json", accept: "text/event-stream", "x-forwarded-for": testIp() },
      data: { messages: [{ role: "user", content: "are you there?" }] },
    });
    expect(res.status()).toBe(423);
    const body = (await res.json()) as { reason?: string; message?: string };
    expect(body.reason).toBe("paused");
    expect(body.message).toBe(COPY.paused);
  });

  test("the UI says it is paused by its guardians and renders no reply", async ({ page }) => {
    await useFreshIp(page);
    await page.goto(`/e/${SLUG}/chat`);
    await sendTurn(page, "hello?");

    // Both the standing banner and the answer to this turn say it, in words.
    await expect(page.getByText(COPY.paused).first()).toBeVisible();
    expect(await page.getByText("paused by my guardians").count()).toBeGreaterThanOrEqual(1);

    // No generated text at all: the placeholder bubble is removed, not left empty.
    await expect(page.locator('[data-generated="ai"]')).toHaveCount(0);
    await expect(reply(page)).toHaveCount(0);
    await expect(page.locator("[data-looked-at]")).toHaveCount(0);
    // …and none of the fake gateway's sentences leaked through.
    await expect(page.locator("body")).not.toContainText("15.4 cubic feet per second");

    // The composer is disabled while paused, so a second turn cannot be sent.
    await expect(page.locator(".chat")).toHaveAttribute("data-chat-state", "paused");
    await expect(page.locator("textarea").first()).toBeDisabled();
  });

  test("the disclosure label is still rendered while paused", async ({ page }) => {
    await page.goto(`/e/${SLUG}/chat`);
    await expect(page.locator('[data-disclosure="ai-voice"]').first()).toHaveText(COPY.disclosure);
  });
});
