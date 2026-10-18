import { expect, test } from "@playwright/test";
import { withSql } from "./db";
import { expectNoAxeViolations, signInAs } from "./helpers";

// Records made here start with "E2E" so they can be told apart from the example data and cleaned up.
const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

test.afterAll(async () => {
  await withSql(async (sql) => {
    await sql`delete from donor_lists where source_label like 'E2E %'`;
    await sql`delete from funders where name like 'E2E %' and id not in (select funder_id from pursuits)`;
  });
});

test("an associate pastes a peer NGO's donors, checks the matches, saves and removes the list", async ({ page }) => {
  const s = stamp();
  const known = `E2E Donor Known ${s} Limited`;
  const knownId = await withSql(async (sql) => (await sql`insert into funders (name, type) values (${known}, 'company') returning id`)[0]!.id as string);
  const source = `E2E Saksham annual report ${s}`;

  await signInAs(page, "Associate");
  await page.goto("/leads");
  await page.getByRole("link", { name: "Add peer NGO donors" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Peer NGO donors" })).toBeVisible();
  await expectNoAxeViolations(page);

  await page.getByRole("button", { name: "Check the list" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Some fields need fixing.");
  await expect(page.getByText("Choose the NGO whose donors these are")).toBeVisible();
  await expect(page.getByText("Paste at least one donor, one per line")).toBeVisible();

  await page.getByLabel("Whose donors are these?").selectOption("Saksham");
  await page.getByLabel("Financial year (optional)").fill("2024-25");
  await page.getByLabel("Where the list comes from").fill(source);
  const donors = page.getByLabel("Donors, one per line");
  await donors.fill(`1. E2E Donor Known ${s} Ltd, 10 lakh\n2. E2E Donor New ${s} Private Limited\n3. e2e donor known ${s} limited`);
  await page.getByRole("button", { name: "Check the list" }).click();

  const preview = page.getByRole("region", { name: /donors of Saksham/ });
  await expect(page.getByRole("heading", { name: "2 donors of Saksham" })).toBeFocused();
  await expect(preview).toContainText("1 already in the portal, 1 new: it'll be added as a company and marked Needs check.");
  await expect(preview.getByRole("row").filter({ hasText: "Donor as written" })).toBeVisible();
  await expect(preview.getByRole("row", { name: new RegExp(`E2E Donor Known ${s} Ltd`) })).toContainText("₹10 L");
  await expect(preview.getByRole("row", { name: new RegExp(`E2E Donor New ${s}`) })).toContainText("New company");
  await expect(preview).toContainText("Same donor as line 1, so it's counted once.");
  await expectNoAxeViolations(page);

  // Saving checks the list again if it changed after the check.
  await donors.fill(`${await donors.inputValue()}\nE2E Donor Extra ${s}`);
  await page.getByRole("button", { name: "Save 2 donors" }).click();
  await expect(page.getByRole("heading", { name: "3 donors of Saksham" })).toBeFocused();
  await expect(page.getByRole("status").filter({ hasText: "The list changed after you checked it" })).toBeAttached();
  await page.getByRole("button", { name: "Save 3 donors" }).click();

  await expect(page.getByRole("status").filter({ hasText: "Saved Saksham's donors: 3 in all, 2 of them new to the portal." })).toBeVisible();
  const row = page.getByRole("region", { name: /Donor lists added/ }).getByRole("row").filter({ hasText: source });
  await expect(row).toContainText("Saksham");
  await expect(row).toContainText("2024-25");
  await expectNoAxeViolations(page);

  // The known company now funds a peer NGO, and its score says so.
  await page.goto(`/funders/${knownId}`);
  await expect(page.getByRole("region", { name: "NGOs it funds" }).getByRole("listitem").filter({ hasText: "Saksham" })).toContainText(source);
  await expect(page.getByRole("main")).toContainText("Funds Saksham");
  const added = await withSql((sql) => sql`select type, eligibility from funders where name = ${`E2E Donor New ${s} Private Limited`}`);
  expect(added).toEqual([{ type: "company", eligibility: "needs_check" }]);

  await page.goto("/leads/donors");
  await row.getByRole("button", { name: /^Remove/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "List removed, with 2 funders it had added." })).toBeVisible();
  await expect(row).toHaveCount(0);
  const left = await withSql((sql) => sql`select name from funders where name like ${`E2E Donor % ${s}%`} order by name`);
  expect(left.map((r) => r.name)).toEqual([known]);
});

test("a list for an NGO that isn't on the peer list says it won't change scores", async ({ page }) => {
  await signInAs(page, "Associate");
  await page.goto("/leads/donors");
  await page.getByLabel("Whose donors are these?").selectOption({ label: "Another NGO…" });
  await page.getByLabel("NGO's name").fill("E2E Unlisted NGO");
  await page.getByLabel("Where the list comes from").fill("E2E website");
  await page.getByLabel("Individuals (HNIs)").check();
  await page.getByLabel("Donors, one per line").fill("E2E Some Person");
  await page.getByRole("button", { name: "Check the list" }).click();
  await expect(page.getByRole("region", { name: /donors? of E2E Unlisted NGO/ })).toContainText("isn't on VE's peer list");
  await expect(page.getByRole("region", { name: /donors? of E2E Unlisted NGO/ })).toContainText("New individual");
  await expect(page.getByRole("region", { name: /donors? of E2E Unlisted NGO/ })).toContainText("0 already in the portal, 1 new: it'll be added as an individual.");
});

test("viewers can see donor lists but not add or remove them", async ({ page }) => {
  await signInAs(page, "Viewer");
  await page.goto("/leads");
  await page.getByRole("link", { name: "Peer NGO donors" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Peer NGO donors" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Add a donor list" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Remove/ })).toHaveCount(0);
  await expectNoAxeViolations(page);
});
