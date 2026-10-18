import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

export async function signInAs(page: Page, role: string) {
  await page.goto("/signin");
  await page.getByRole("radio", { name: role, exact: true }).check();
  await page.getByRole("button", { name: "Continue as demo user" }).click();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
}

export async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
}
