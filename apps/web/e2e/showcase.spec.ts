import { expect, test } from "@playwright/test";

test("reporter seals sample evidence and receives eight codename words", async ({ page }) => {
  await page.goto("/report/northwind-ethics");
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page.getByRole("button", { name: "Use test passport A", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Use sample evidence", exact: true }).click();
  await page.getByRole("button", { name: "Clean and review", exact: true }).click();
  await page.getByRole("button", { name: "Looks right", exact: true }).click();
  await page.getByRole("button", { name: "Seal and send", exact: true }).click();
  const receipt = page.getByRole("button", { name: "Get my receipt", exact: true });
  await expect(receipt).toBeEnabled({ timeout: 90_000 });
  await receipt.click();
  await expect(page.getByRole("heading", { name: "Your report is sealed and sent" })).toBeVisible();
  const words = page.getByRole("list").filter({
    has: page.getByRole("listitem").filter({ hasText: /^1\s*[a-z]+$/ }),
  }).getByRole("listitem");
  await expect(words).toHaveCount(8);
  for (let index = 0; index < 8; index++) {
    const valid = await words.nth(index).evaluate((element, number) =>
      new RegExp(`^${number}\\s*[a-z]+$`).test(element.textContent?.trim() || ""), index + 1);
    expect(valid, "Receipt entry contains a numbered word").toBe(true);
  }
});

test("Avery Chen opens the first report brief", async ({ page }) => {
  await page.goto("/console");
  await page.getByRole("button", { name: /Avery Chen/ }).click();
  await expect(page.getByRole("heading", { name: "Reports", exact: true })).toBeVisible();
  await page.getByRole("table").getByRole("link").first().click();
  await page.getByRole("tab", { name: "Brief", exact: true }).click();
  await expect(page.getByRole("heading", { name: "What the evidence shows" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Evidence profile" })).toBeVisible();
});
