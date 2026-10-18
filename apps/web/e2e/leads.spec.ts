import { execSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { withSql } from "./db";
import { expectNoAxeViolations, signInAs } from "./helpers";

// Records made here start with "E2E" so they can be told apart from the example data and cleaned up.
const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const cin = (state: string) => `U85110${state}2015PTC${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`;

/** Runs what the worker would: queued imports and pending rescoring. */
function runWorkerOnce() {
  execSync("pnpm --filter @ve/ingest run-pending", { cwd: path.resolve(process.cwd(), "../.."), stdio: "pipe" });
}

test.afterAll(async () => {
  await withSql(async (sql) => {
    await sql`delete from pursuits where funder_id in (select id from funders where name like 'E2E %')`;
    await sql`delete from funders where name like 'E2E %'`;
    await sql`delete from data_imports where file_name like 'e2e-%'`;
  });
});

test("an associate imports a CSR Portal file and the companies are ranked", async ({ page }) => {
  const s = stamp();
  const strong = `E2E Strong Fit ${s}`;
  const small = `E2E Small Spender ${s}`;
  const strongCin = cin("KA");
  const rows = [
    "CIN,Company Name,Financial Year,Prescribed CSR Expenditure (INR Cr.),Amount Spent (INR Cr.),Development Sector,State,Project Name",
    `${strongCin},${strong},2022-23,2.0,1.5,Education,Karnataka,School labs`,
    `${strongCin},${strong},2023-24,2.5,2.0,Education,Karnataka,School labs`,
    `${strongCin},${strong},2023-24,2.5,0.5,Differently Abled,Karnataka,Braille displays`,
    `${cin("TN")},${small},2023-24,,0.02,Education,Tamil Nadu,Uniforms`,
    `${cin("TN")},Broken row,someday,,1,Education,Tamil Nadu,`,
  ].join("\n");

  await signInAs(page, "Associate");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "CSR leads" }).click();
  await page.getByRole("link", { name: "Import CSR data" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Import CSR data" })).toBeVisible();
  await expectNoAxeViolations(page);

  await page.getByLabel("CSV file").setInputFiles({ name: `e2e-${s}.csv`, mimeType: "text/csv", buffer: Buffer.from(rows) });
  await page.getByRole("button", { name: "Upload and import" }).click();
  await expect(page.getByRole("status")).toContainText("Uploaded. The import runs in the background");
  const row = page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: new RegExp(`e2e-${s}`) }) });
  await expect(row).toContainText("Waiting");

  runWorkerOnce();
  await page.reload();
  await expect(row).toContainText("Done");
  await expect(row).toContainText("2 companies from 5 rows, 2 new");
  await row.getByText("1 row skipped").click();
  await expect(row).toContainText('Row 6: Couldn\'t read the financial year "someday"');

  await page.goto(`/leads?q=${encodeURIComponent(`E2E Strong Fit ${s}`)}`);
  const lead = page.getByRole("row").filter({ has: page.getByRole("link", { name: strong }) });
  await expect(lead).toContainText("Eligible");
  await expect(lead).toContainText("₹2.5 Cr");
  await expect(lead).toContainText("100% of CSR spend on education and skills, ₹50 L on disability");

  // Below the floor: hidden unless asked for.
  await page.goto(`/leads?q=${encodeURIComponent(small)}`);
  await expect(page.getByRole("heading", { name: "No companies match" })).toBeVisible();
  await page.getByLabel("Eligibility").selectOption({ label: "Everything, including not eligible" });
  await page.getByRole("button", { name: "Show leads" }).click();
  await expect(page.getByRole("row").filter({ has: page.getByRole("link", { name: small }) })).toContainText("Not eligible");
});

test("the leads list filters by state and cause", async ({ page }) => {
  await signInAs(page, "Viewer");
  await page.goto("/leads");
  await expect(page.getByRole("link", { name: "Example: Deccan Semiconductors India" })).toBeVisible();
  await expectNoAxeViolations(page);

  await page.getByLabel("Spends in").selectOption("Karnataka");
  await page.getByLabel("Cause").selectOption({ label: "Disability" });
  await page.getByRole("button", { name: "Show leads" }).click();
  await expect(page).toHaveURL(/state=Karnataka/);
  await expect(page.getByRole("link", { name: "Example: Deccan Semiconductors India" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Example: Kaveri Auto Components" })).toHaveCount(0);
  await page.getByRole("link", { name: "Clear filters" }).click();
  await expect(page.getByRole("link", { name: "Example: Kaveri Auto Components" })).toBeVisible();
});

test("a company's page explains its score, and what VE adds changes it", async ({ page }) => {
  const s = stamp();
  const name = `E2E Profile Co ${s}`;
  const id = await withSql(async (sql) => {
    const [f] = await sql`insert into funders (name, type, cin) values (${name}, 'company', ${cin("KA")}) returning id`;
    for (const [fy, spent] of [["2022-23", 20_000_000], ["2023-24", 30_000_000]] as const) {
      await sql`insert into csr_years (funder_id, fy, spent, project_count) values (${f!.id}, ${fy}, ${spent}, 3)`;
      await sql`insert into csr_breakdown (funder_id, fy, kind, name, amount) values
        (${f!.id}, ${fy}, 'sector', 'Education', ${spent}), (${f!.id}, ${fy}, 'state', 'Karnataka', ${spent})`;
    }
    return f!.id as string;
  });

  await signInAs(page, "Associate");
  await page.goto(`/funders/${id}`);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Not scored yet.");

  // Adding a peer NGO scores the company and fills the peer part.
  const grantees = page.getByRole("region", { name: "NGOs it funds" });
  await grantees.getByLabel("NGO").fill("Saksham Trust");
  await grantees.getByLabel("Amount (optional)").fill("40 lakh");
  await grantees.getByRole("button", { name: "Add NGO" }).click();
  await expect(grantees.getByRole("status")).toHaveText("Added Saksham Trust.");
  const peer = page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: /^Peer NGOs/ }) });
  await expect(peer).toContainText("10 of 20");
  await expect(peer).toContainText("Funds Saksham");
  await expect(page.getByRole("region", { name: "Eligibility" })).toContainText("Eligible");
  await expectNoAxeViolations(page);

  await page.getByLabel("Warm path").fill("Our trustee sits on their CSR committee.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("region", { name: "What VE knows" }).getByRole("status")).toHaveText("Saved, and the fit score is up to date.");
  await expect(page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: /^Warm path/ }) })).toContainText("10 of 10");

  await page.getByLabel("This is a foreign company or a multinational parent").check();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("region", { name: "Eligibility" })).toContainText("Not eligible");
  await page.getByLabel("This is a foreign company or a multinational parent").uncheck();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("region", { name: "Eligibility" })).toContainText("Eligible");

  await grantees.getByRole("button", { name: "Remove Saksham Trust" }).click();
  await expect(peer).toContainText("0 of 20");

  // Start a pursuit from the profile; the funder is already chosen.
  await page.getByRole("link", { name: "Start a pursuit" }).click();
  await expect(page.getByLabel("Funder", { exact: true })).toHaveValue(id);
  await page.getByLabel("What VE is asking for").fill(`E2E CSR ask ${s}`);
  await page.getByRole("button", { name: "Add pursuit" }).click();
  await page.getByRole("link", { name }).click();
  await expect(page.getByRole("region", { name: "In the pipeline" })).toContainText(`E2E CSR ask ${s}`);
});

test("admins change the fit weights and every company is rescored", async ({ page }) => {
  await signInAs(page, "Admin");
  await page.goto("/settings");
  const fit = page.getByRole("region", { name: "Fit score" });
  await expect(fit.getByText("Total: 100 of 100")).toBeVisible();
  await expectNoAxeViolations(page);

  await fit.getByLabel("Cause").fill("40");
  await expect(fit.getByText("Total: 110 of 100")).toBeVisible();
  await fit.getByRole("button", { name: "Save fit settings" }).click();
  await expect(fit.getByRole("alert")).toContainText("The weights must add up to 100. They add up to 110.");

  try {
    await fit.getByLabel("Warm path").fill("0");
    await fit.getByRole("button", { name: "Save fit settings" }).click();
    await expect(fit.getByRole("status")).toHaveText("Saved, and every company has been rescored.");
    await page.goto("/funders/" + (await withSql((sql) => sql`select id from funders where name = 'Example: Deccan Semiconductors India'`))[0]!.id);
    await expect(page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: /^Cause/ }) })).toContainText("of 40");
  } finally {
    // Put the starting weights back for the other tests.
    await page.goto("/settings");
    await fit.getByLabel("Cause").fill("30");
    await fit.getByLabel("Warm path").fill("10");
    await fit.getByRole("button", { name: "Save fit settings" }).click();
    await expect(fit.getByRole("status")).toHaveText("Saved, and every company has been rescored.");
  }
});

test("viewers can browse leads but not import or change anything", async ({ page }) => {
  await signInAs(page, "Viewer");
  await page.goto("/leads");
  await expect(page.getByRole("link", { name: "Import CSR data" })).toHaveCount(0);
  await page.getByRole("link", { name: "See imports" }).click();
  await expect(page.getByRole("button", { name: "Upload and import" })).toHaveCount(0);
  await page.goto("/leads");
  await page.getByRole("link", { name: "Example: Deccan Semiconductors India" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Fit score" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Start a pursuit" })).toHaveCount(0);
  await expect(page.getByRole("main").getByRole("button")).toHaveCount(0);
  await expectNoAxeViolations(page);
});
