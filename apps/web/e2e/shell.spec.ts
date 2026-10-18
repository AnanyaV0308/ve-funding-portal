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

test("everyone chooses their own emails, but only admins manage people", async ({ page }) => {
  await signInAs(page, "Associate");
  await page.goto("/settings");
  await expect(page.getByRole("heading", { level: 2, name: "Emails to me" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^People/ })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Emails sent" })).toHaveCount(0);
  await expectNoAxeViolations(page);

  const digest = page.getByRole("checkbox", { name: /Weekly digest/ });
  await digest.uncheck();
  await page.getByRole("button", { name: "Save email choices" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Email choices saved." })).toBeVisible();
  await page.reload();
  await expect(digest).not.toBeChecked();
  // Put it back so the test can run again.
  await digest.check();
  await page.getByRole("button", { name: "Save email choices" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Email choices saved." })).toBeVisible();
});
