import { expect, test } from "@playwright/test";

test.describe("beings.earth landscape", () => {
  test("a habitat preview is explicit about missing senses and cannot open a fake chat", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Forests", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Visit The forest", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Visit Boulder Creek", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", {
        name: "The forest A home under the canopy ↗",
        exact: true,
      })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("not connected to sensors");
    await expect(dialog.getByRole("textbox")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Senses", exact: true }).click();
    await expect(
      dialog.getByText("Awaiting a connection", { exact: true }),
    ).toHaveCount(3);
    await dialog.getByRole("button", { name: "Return to landscape" }).click();
    await expect(dialog).not.toBeVisible();
  });
  test("a published being opens actual readings and chat in the landscape", async ({
    page,
  }) => {
    await page.goto("/");
    await page
      .getByRole("button", {
        name: "Boulder Creek Public being ↗",
        exact: true,
      })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("An AI voice for Boulder Creek");
    await expect(
      dialog.getByRole("link", { name: "Open observatory ↗" }),
    ).toHaveAttribute("href", "/e/boulder-creek");
    await dialog.getByRole("button", { name: "Senses", exact: true }).click();
    await expect(dialog.locator("[data-need]").first()).toBeVisible();
    await expect(dialog).toContainText("can't feel it");
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
  });
  test("Kami guide answers are a written introduction and filters reset", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Meet Kami ↗" }).click();
    await expect(page.getByLabel("Kami guide", { exact: true })).toContainText(
      "written introduction",
    );
    await page.getByRole("button", { name: "What is real here?" }).click();
    await expect(page.getByLabel("Kami guide", { exact: true })).toContainText(
      "The landscape is an illustration",
    );
    await page.getByRole("button", { name: "Close Kami guide" }).click();
    await page.getByRole("button", { name: "Water", exact: true }).click();
    await page.getByRole("button", { name: "Reset view" }).click();
    await expect(
      page.getByRole("button", { name: "All beings", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
});
