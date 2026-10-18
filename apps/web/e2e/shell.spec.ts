import { expect, test } from "@playwright/test";
import { expectNoAxeViolations, signInAs } from "./helpers";

test("signed-out visitors are sent to sign in", async ({ page }) => {
  await page.goto("/pipeline");
  await expect(page).toHaveURL(/\/signin/);
  await expect(page.getByRole("heading", { name: "Sign in to VE Funding" })).toBeVisible();
  await expectNoAxeViolations(page);
});

test("every Phase 1 screen opens and passes the accessibility check", async ({ page }) => {
  await signInAs(page, "Admin");
  const screens: [string, string][] = [
    ["This week", "Welcome, Demo"],
    ["CSR leads", "CSR leads"],
    ["Pipeline", "Pipeline"],
    ["Awards calendar", "Awards and grants calendar"],
    ["Knowledge base", "VE knowledge base"],
    ["Settings", "Settings"],
  ];
  for (const [link, heading] of screens) {
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: link }).click();
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.getByRole("link", { name: link })).toHaveAttribute("aria-current", "page");
    await expectNoAxeViolations(page);
  }
});

test("an admin can change someone's roles", async ({ page }) => {
  await signInAs(page, "Admin");
  await page.goto("/settings");
  const viewer = page.getByRole("listitem").filter({ hasText: "viewer@demo.visionempower.local" });
  await viewer.getByRole("checkbox", { name: "Associate" }).check();
  await viewer.getByRole("button", { name: "Save roles" }).click();
  await expect(viewer.getByRole("status")).toHaveText("Roles saved.");
  // Put it back so the test can run again.
  await viewer.getByRole("checkbox", { name: "Associate" }).uncheck();
  await viewer.getByRole("button", { name: "Save roles" }).click();
  await expect(viewer.getByRole("status")).toHaveText("Roles saved.");
});

test("the last admin can't remove their own admin role", async ({ page }) => {
  await signInAs(page, "Admin");
  await page.goto("/settings");
  const me = page.getByRole("listitem").filter({ hasText: "admin@demo.visionempower.local" });
  await me.getByRole("checkbox", { name: "Admin" }).uncheck();
  await me.getByRole("button", { name: "Save roles" }).click();
  await expect(me.getByRole("status")).toHaveText(/at least one admin/);
});

test("people without the right role can't open Settings", async ({ page }) => {
  await signInAs(page, "Associate");
  await page.goto("/settings");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("You can't open Settings");
});
