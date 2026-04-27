import { test, expect } from "@playwright/test";

test("frontend root renders", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Vite|React/);
});
