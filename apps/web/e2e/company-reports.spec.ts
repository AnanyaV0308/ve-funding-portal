import { exec } from "node:child_process";
import { promisify } from "node:util";
import { expect, type Page, test } from "@playwright/test";
import { withSql } from "./db";
import { expectNoAxeViolations, signInAs } from "./helpers";

// Records made here start with "E2E" so they can be told apart from the example data and cleaned up.
const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const listedCin = () => `L85110KA2015PLC${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`;

test.afterAll(async () => {
  await withSql(async (sql) => {
    await sql`delete from funders where name like 'E2E %' and id not in (select funder_id from pursuits)`;
    await sql`delete from app_settings where key = 'companies_followed'`;
  });
});

/** A listed company with two years of CSR Portal data, spent on education in Karnataka. */
async function listedCompany(name: string) {
  return withSql(async (sql) => {
    const [f] = await sql`insert into funders (name, type, cin) values (${name}, 'company', ${listedCin()}) returning id`;
    // The same years as the example data, so the two latest years in the data stay the same for other tests.
    for (const [fy, spent] of [
      ["2022-23", 20_000_000],
      ["2023-24", 25_000_000],
    ] as const) {
      await sql`insert into csr_years (funder_id, fy, spent, project_count) values (${f!.id}, ${fy}, ${spent}, 4)`;
      await sql`insert into csr_breakdown (funder_id, fy, kind, name, amount) values
        (${f!.id}, ${fy}, 'sector', 'Education', ${spent}), (${f!.id}, ${fy}, 'state', 'Karnataka', ${spent})`;
    }
    return f!.id as string;
  });
}

/** The company's 2025-26 report, as the reader would have left it, with the NGO it added. */
async function readReport(funderId: string, name: string) {
  await withSql(async (sql) => {
    const partners = [
      { name: "Saksham Trust", kind: "ngo", amountInr: 4_000_000, registration: "CSR00001234", page: 212 },
      { name: `${name} Foundation`, kind: "own_foundation", amountInr: 50_000_000, registration: null, page: 212 },
    ];
    const leftOut = [{ name: `${name} Foundation`, reason: "own_foundation" }];
    const disability = [{ description: "Digital skills for visually impaired students in Karnataka.", amountInr: 3_000_000, page: 214 }];
    const [r] = await sql`insert into company_reports (funder_id, origin, url, title, fy, status, obligation, spent, unspent, policy_url, partners, left_out,
        disability_work, pages, pages_read, read_at)
      values (${funderId}, 'search', 'https://example.com/investors/annual-report-2025-26.pdf', ${`${name} annual report 2025-26`}, '2025-26', 'read',
        35000000, 34000000, 1000000, 'https://example.com/csr', ${sql.json(partners)}, ${sql.json(leftOut)}, ${sql.json(disability)}, 380,
        ${sql.json([212, 213, 214, 215])}, now())
      returning id`;
    await sql`insert into funder_grantees (funder_id, name, fy, amount, source_label, source_url, company_report_id)
      values (${funderId}, 'Saksham Trust', '2025-26', 4000000, ${`${name} annual report 2025-26, page 212`},
        'https://example.com/investors/annual-report-2025-26.pdf#page=212', ${r!.id})`;
  });
}

/** Scores the company again the way any edit on its page does. */
async function rescore(page: Page) {
  await page.getByLabel("Warm path").fill("");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("region", { name: "What VE knows" }).getByRole("status")).toHaveText("Saved, and the fit score is up to date.");
}

const fitRow = (page: Page, part: RegExp) => page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: part }) });

test("a read annual report shows its CSR figures and partners, and counts in the fit score", async ({ page }) => {
  const name = `E2E Listed Co ${stamp()}`;
  const id = await listedCompany(name);
  await readReport(id, name);

  await signInAs(page, "Associate");
  await page.goto(`/funders/${id}`);
  await rescore(page);

  const section = page.getByRole("region", { name: "Annual report" });
  await expect(section.getByRole("heading", { name: `${name} annual report 2025-26` })).toBeVisible();
  await expect(section).toContainText("from pages 212–215 of 380");
  await expect(section.getByRole("definition").first()).toHaveText("₹3.5 Cr");
  await expect(section).toContainText("Digital skills for visually impaired students in Karnataka.");
  await expect(section.getByRole("link", { name: /page 214/ })).toHaveAttribute("href", "https://example.com/investors/annual-report-2025-26.pdf#page=214");
  await expect(section).toContainText("1 NGO it names was added to the NGOs it funds");
  await section.getByText("Left out: 1 organisation").click();
  await expect(section).toContainText(`${name} Foundation · The company's own foundation or trust`);

  // The NGO it names is a peer, its disability work counts as cause, and its 2025-26 budget is up on 2023-24.
  await expect(fitRow(page, /^Peer NGOs/)).toContainText("Funds Saksham");
  await expect(fitRow(page, /^Cause/)).toContainText("its FY 2025-26 annual report describes work on disability");
  await expect(fitRow(page, /^Cause/)).toContainText("30 of 30");
  await expect(fitRow(page, /^Timing/)).toContainText("FY 2025-26 CSR budget of ₹3.5 Cr is 40% above FY 2023-24 spend, per its annual report");
  await expect(page.getByRole("region", { name: "NGOs it funds" }).getByRole("link", { name: `${name} annual report 2025-26, page 212` })).toBeVisible();
  await expectNoAxeViolations(page);

  // Removing the report takes away the NGO it added, and the score with it.
  await section.getByRole("button", { name: `Remove ${name} annual report 2025-26 and the NGOs it added` }).click();
  await expect(section).toContainText("No annual report yet.");
  await expect(fitRow(page, /^Peer NGOs/)).toContainText("0 of 20");
  await expect(fitRow(page, /^Cause/)).not.toContainText("annual report");
});

test("an associate adds a report by link or upload, but never from NSE or BSE", async ({ page }) => {
  const name = `E2E Upload Co ${stamp()}`;
  const id = await listedCompany(name);
  await signInAs(page, "Associate");
  await page.goto(`/funders/${id}`);
  const section = page.getByRole("region", { name: "Annual report" });
  await section.getByText("Add a report by hand").click();

  const link = section.getByLabel("Link to the report's PDF");
  await link.fill("https://nsearchives.nseindia.com/annual_reports/AR_1_E2E_2025_2026.pdf");
  await section.getByRole("button", { name: "Add the link" }).click();
  await expect(section.getByText(/The portal doesn't fetch from NSE or BSE/)).toBeVisible();

  await link.fill("https://example.com/investors/e2e-annual-report.pdf");
  await section.getByRole("button", { name: "Add the link" }).click();
  await expect(section.getByText("Added. The portal will read it in the next few minutes.")).toBeVisible();
  await page.reload();
  await expect(section).toContainText("Waiting for an Anthropic API key to be read");

  await section.getByText("Add a report by hand").click();
  await section
    .getByLabel("Or upload the PDF")
    .setInputFiles({ name: "e2e-annual-report.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF\n") });
  await section.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(section.getByText("Uploaded. The portal will read it in the next few minutes.")).toBeVisible();
  await expect(section.getByRole("list", { name: "Other annual reports" }).getByRole("listitem")).toHaveCount(2);
  await expectNoAxeViolations(page);

  // Without an API key the worker can't look on the web, and says so.
  await section.getByRole("button", { name: "Look for its newest report" }).click();
  await expect(section).toContainText("The portal will look for its newest report in the next few minutes.");
  await promisify(exec)("pnpm --filter @ve/ingest company-reports", { cwd: "../..", env: { ...process.env, ANTHROPIC_API_KEY: "" } });
  await page.reload();
  await expect(section).toContainText("Looking for annual reports needs the Anthropic API key, which isn't set up yet.");
});

test("admins choose how many companies the portal follows", async ({ page }) => {
  const name = `E2E Followed Co ${stamp()}`;
  await listedCompany(name);

  await signInAs(page, "Associate");
  await page.goto("/leads");
  await page.getByRole("link", { name: "Companies followed" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Companies followed" })).toBeVisible();
  await expect(page.getByRole("spinbutton", { name: "Companies to follow" })).toHaveCount(0);

  await page.context().clearCookies();
  await signInAs(page, "Admin");
  await page.goto("/leads/followed");
  const count = page.getByRole("spinbutton", { name: "Companies to follow" });
  await count.fill("1001");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Enter a whole number" })).toBeVisible();
  await count.fill("1000");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved. The portal follows the 1000 best-fitting companies." })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("table").getByRole("link", { name })).toBeVisible();
  await expectNoAxeViolations(page);

  await count.fill("0");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved. The portal won't look for reports or plans on its own." })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("table")).toHaveCount(0);
});
