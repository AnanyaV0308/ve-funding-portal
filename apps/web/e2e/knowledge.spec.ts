import { expect, test } from "@playwright/test";
import { withSql } from "./db";
import { expectNoAxeViolations, signInAs } from "./helpers";

test("viewers can read the knowledge base but not change it", async ({ page }) => {
  await signInAs(page, "Viewer");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Knowledge base" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Organisation" })).toBeVisible();
  await expect(page.getByRole("rowheader", { name: "CSR-1 registration" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Add a fact" })).toHaveCount(0);
  await expectNoAxeViolations(page);

  await page.getByRole("link", { name: "Documents" }).click();
  await expect(page.getByRole("heading", { name: "Add a document" })).toHaveCount(0);
  await expectNoAxeViolations(page);

  await page.goto("/knowledge/facts/new");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("You can't open this page");
});

test("an associate confirms a researched fact is still correct", async ({ page }) => {
  await withSql((sql) => sql`update knowledge_facts set confirmed_at = null, confirmed_by = null where title = 'PAN'`);
  await signInAs(page, "Associate");
  await page.goto("/knowledge?category=organisation");
  const row = page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "PAN", exact: true }) });
  await expect(row).toContainText("Needs confirming");
  await row.getByRole("button", { name: "Still correct: PAN" }).click();
  await expect(row).toContainText("Current");
  await expect(row.getByRole("button")).toHaveCount(0);
});

test("an associate adds, edits and deletes a fact", async ({ page }) => {
  const title = `Test fact ${Date.now()}`;
  await signInAs(page, "Associate");
  await page.goto("/knowledge");
  await page.getByRole("link", { name: "Add a fact" }).click();
  await expectNoAxeViolations(page);

  await page.getByLabel("Category").selectOption("impact");
  await page.getByLabel("Name").fill(title);
  await page.getByLabel("Fact", { exact: true }).fill("1,234");
  await page.getByLabel("Source link (optional)").fill("not a url");
  await page.getByRole("button", { name: "Add fact" }).click();
  await expect(page.getByText("Enter a full web address, starting with https://")).toBeVisible();

  await page.getByLabel("Source link (optional)").fill("https://visionempowertrust.org/");
  await page.getByRole("button", { name: "Add fact" }).click();
  await expect(page.getByRole("status")).toHaveText("Fact saved and marked as checked.");
  const row = page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: title }) });
  await expect(row).toContainText("1,234");
  await expect(row).toContainText("Current");

  await row.getByRole("link", { name: title }).click();
  await page.getByLabel("Fact", { exact: true }).fill("1,500");
  await page.getByRole("button", { name: "Save and mark as checked" }).click();
  await expect(page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: title }) })).toContainText("1,500");

  await page.getByRole("link", { name: title }).click();
  await page.getByRole("button", { name: "Delete this fact" }).click();
  await page.getByRole("button", { name: "Yes, delete" }).click();
  await expect(page.getByRole("status")).toHaveText("Fact deleted.");
  await expect(page.getByRole("rowheader", { name: title })).toHaveCount(0);
});

test("an associate uploads a document and a new version, and downloads it", async ({ page }) => {
  const title = `Annual report test ${Date.now()}`;
  await signInAs(page, "Associate");
  await page.goto("/knowledge/documents");
  await expectNoAxeViolations(page);

  const add = page.getByRole("form", { name: "Add a document" });
  await add.getByLabel("File").setInputFiles({ name: "report.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 first") });
  await add.getByLabel("Title").fill(title);
  await add.getByLabel("Type").selectOption("annual_report");
  await add.getByLabel("Year or period (optional)").fill("2025-26");
  await add.getByRole("button", { name: "Upload document" }).click();
  await expect(add.getByRole("status")).toHaveText("Document added.");

  const card = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: title }) });
  await expect(card).toContainText("Annual report · 2025-26");
  const v1 = await card.getByRole("link", { name: /Download v1/ }).getAttribute("href");
  const r1 = await page.request.get(v1!);
  expect(r1.status()).toBe(200);
  expect(await r1.text()).toBe("%PDF-1.4 first");

  await card.getByText("Upload a new version").click();
  const versionForm = card.getByRole("form", { name: `Upload a new version of ${title}` });
  await versionForm.getByLabel("New version").setInputFiles({ name: "report-v2.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 second") });
  await versionForm.getByRole("button", { name: "Upload new version" }).click();
  await expect(versionForm.getByRole("status")).toHaveText("Version 2 uploaded.");
  await expect(card.getByRole("link", { name: /Download v2/ })).toBeVisible();
  await expect(card.getByText("Earlier versions (1)")).toBeVisible();
});

test("files can't be uploaded with a forged link or downloaded when signed out", async ({ page, request }) => {
  const forged = await request.put("/api/files/upload?key=uploads/2026/00000000-0000-0000-0000-000000000000/x.pdf&exp=9999999999&sig=nope", {
    data: "x",
  });
  expect(forged.status()).toBe(403);
  const anon = await page.request.get("/api/files/00000000-0000-0000-0000-000000000000");
  expect(anon.status()).toBe(401);
});

test("unsupported file types are refused", async ({ page }) => {
  await signInAs(page, "Associate");
  await page.goto("/knowledge/documents");
  const add = page.getByRole("form", { name: "Add a document" });
  await add.getByLabel("File").setInputFiles({ name: "script.exe", mimeType: "application/x-msdownload", buffer: Buffer.from("MZ") });
  await add.getByLabel("Title").fill("Bad file");
  await add.getByLabel("Type").selectOption("other");
  await add.getByRole("button", { name: "Upload document" }).click();
  await expect(add.getByRole("status")).toContainText("Upload a PDF, Word, Excel, PowerPoint, image, text or CSV file.");
});
