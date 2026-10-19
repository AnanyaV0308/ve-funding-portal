import { exec } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import { withSql } from "./db";
import { expectNoAxeViolations, signInAs } from "./helpers";

// Records made here start with "E2E" so they can be told apart from the example data and cleaned up.
const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
// A peer NGO with no reports page of its own in the example data, so the test can point it at a local one.
const PEER = "Sense International India";

// A stand-in for an NGO's website: a reports page linking to its annual reports.
let site: Server;
let siteUrl = "";
test.beforeAll(async () => {
  site = createServer((req, res) => {
    if (req.url === "/reports/") {
      res.setHeader("content-type", "text/html");
      res.end(`<h1>Reports</h1>
        <a href="/files/Annual-Report-2022-23.pdf">Annual Report 2022-23</a>
        <a href="/files/Annual-Report-2024-25.pdf">Annual Report 2024-25</a>
        <a href="/files/Annual-Report-2023-24.pdf">Annual Report 2023-24</a>
        <a href="/files/Audit-Report-2024-25.pdf">Audit report 2024-25</a>`);
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
  siteUrl = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  site.close();
  await withSql(async (sql) => {
    await sql`delete from donor_lists where source_label like 'E2E %'`;
    await sql`delete from peer_sources where ngo_name like 'E2E %' or url like 'http://127.0.0.1:%'`;
    await sql`delete from funders where name like 'E2E %' and id not in (select funder_id from pursuits)`;
  });
});

/** A report the portal has already read, as the reader would have left it. */
async function readReport(ngo: string, status: "ready" | "failed", donors: object[] = [], error: string | null = null) {
  return withSql(async (sql) => {
    const [source] = await sql`insert into peer_sources (ngo_name, url, last_checked_at, last_ok, last_result)
      values (${ngo}, 'https://example.org/reports/', now(), true, 'Found 1 new report.') returning id`;
    const [report] = await sql`insert into peer_reports (source_id, url, title, fy, status, donors, pages, pages_read, error, read_at)
      values (${source!.id}, 'https://example.org/files/AR-2024-25.pdf', 'Annual Report 2024-25', '2024-25', ${status}, ${sql.json(donors as never)}, 60, ${sql.json([41, 42])}, ${error}, now())
      returning id`;
    return report!.id as string;
  });
}

const donor = (name: string, kind: string, extra: object = {}) => ({ name, kind, inIndia: true, cin: null, amountInr: null, page: 41, ...extra });

test("an associate points the portal at an NGO's reports page, and it finds the newest reports", async ({ page }) => {
  await signInAs(page, "Associate");
  await page.goto("/leads/donors");
  const where = page.getByRole("region", { name: "Where the portal looks" });
  const row = where.getByRole("row", { name: new RegExp(PEER) });

  await row.getByLabel(`${PEER}'s reports page`, { exact: true }).fill("not a link");
  await row.getByRole("button", { name: `Save ${PEER}'s reports page` }).click();
  await expect(row.getByRole("status")).toHaveText("Paste the full link, starting with https://");

  await row.getByLabel(`${PEER}'s reports page`, { exact: true }).fill(`${siteUrl}/reports/`);
  await row.getByRole("button", { name: `Save ${PEER}'s reports page` }).click();
  await expect(row.getByRole("status")).toHaveText("Saved. The portal will look at this page in the next few minutes.");
  await page.reload();
  await expect(row).toContainText("Looking soon");
  await expectNoAxeViolations(page);

  // What the worker does every minute, for this NGO only. Tests run from apps/web. Not execSync, which
  // would stop this process's stand-in website from answering.
  await promisify(exec)(`pnpm --filter @ve/ingest peer-reports "${PEER}"`, { cwd: "../.." });
  await page.reload();
  await expect(row).toContainText("Found 2 new reports.");
  await expect(row.getByRole("link", { name: "FY 2024-25" })).toBeVisible();
  const reports = await withSql(
    (sql) => sql`select r.fy from peer_reports r join peer_sources s on s.id = r.source_id where s.ngo_name = ${PEER} order by r.fy desc`,
  );
  // The two newest, and not the audit report.
  expect(reports.map((r) => r.fy)).toEqual(["2024-25", "2023-24"]);

  await row.getByRole("link", { name: "FY 2024-25" }).click();
  await expect(page.getByRole("heading", { level: 1, name: `${PEER} annual report 2024-25` })).toBeVisible();
  await expect(page.getByRole("main")).toContainText(/Waiting (to be read|for an Anthropic API key to be read)/);
});

test("someone checks the donors read from a report and adds them in one go", async ({ page }) => {
  const s = stamp();
  const ngo = `E2E NGO ${s}`;
  const known = `E2E Report Known ${s} Limited`;
  const knownId = await withSql(async (sql) => (await sql`insert into funders (name, type) values (${known}, 'company') returning id`)[0]!.id as string);
  const id = await readReport(ngo, "ready", [
    donor(`E2E Report Known ${s} Ltd`, "company", { amountInr: 2_500_000, page: 41 }),
    donor(`E2E Report New ${s} Pvt Ltd`, "company", { page: 42 }),
    donor(`E2E Report Trust ${s}`, "foundation", { page: 42 }),
    donor("Ministry of Social Justice and Empowerment", "government"),
    donor("Perkins School for the Blind", "foundation", { inIndia: false }),
    donor("Ravi Kumar", "individual"),
  ]);
  const label = `${ngo} annual report 2024-25`;

  await signInAs(page, "Associate");
  await page.goto("/leads/donors");
  const toCheck = page
    .getByRole("region", { name: /Donor lists to check/ })
    .getByRole("listitem")
    .filter({ hasText: label });
  await expect(toCheck).toContainText("3 donors read, 2 new to the portal");
  await toCheck.getByRole("link", { name: `Check ${label}` }).click();

  await expect(page.getByRole("heading", { level: 1, name: label })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "3 donors to add" })).toBeVisible();
  const table = page.getByRole("region", { name: "Donors read from the report" });
  await expect(table.getByRole("row", { name: new RegExp(`E2E Report Known ${s} Ltd`) })).toContainText("₹25 L");
  await expect(table.getByRole("row", { name: new RegExp(`E2E Report New ${s}`) })).toContainText("New company");
  await expect(table.getByRole("row", { name: new RegExp(`E2E Report Trust ${s}`) })).toContainText("New foundation");
  await expect(table.getByRole("link", { name: "Page 42 of the report (opens in a new tab)" }).first()).toHaveAttribute("href", /#page=42$/);
  await expect(page.getByRole("main")).toContainText("Government bodies: Ministry of Social Justice and Empowerment");
  await expect(page.getByRole("main")).toContainText("Registered outside India, and VE can't take foreign money: Perkins School for the Blind");
  await expect(page.getByRole("main")).toContainText("People, whom the portal doesn't add on its own: Ravi Kumar");
  await expectNoAxeViolations(page);

  await page.getByRole("button", { name: "Add these 3 donors" }).click();
  await expect(page.getByRole("status").filter({ hasText: `Saved ${ngo}'s donors: 3 in all, 2 of them new to the portal.` })).toBeVisible();
  const list = page
    .getByRole("region", { name: /Donor lists added/ })
    .getByRole("row")
    .filter({ hasText: label });
  await expect(list).toContainText("2 new, read from the report");
  await expect(
    page
      .getByRole("region", { name: /Donor lists to check/ })
      .getByRole("listitem")
      .filter({ hasText: label }),
  ).toHaveCount(0);

  const added = await withSql(
    (sql) => sql`select name, type, eligibility from funders where name like ${`E2E Report % ${s}%`} and id <> ${knownId} order by name`,
  );
  expect(added.map((f) => [f.name, f.type])).toEqual([
    [`E2E Report New ${s} Pvt Ltd`, "company"],
    [`E2E Report Trust ${s}`, "foundation"],
  ]);
  expect(added[0]!.eligibility).toBe("needs_check");
  await page.goto(`/funders/${knownId}`);
  await expect(page.getByRole("region", { name: "NGOs it funds" }).getByRole("listitem").filter({ hasText: ngo })).toContainText(label);

  await page.goto(`/leads/donors/reports/${id}`);
  await expect(page.getByRole("main")).toContainText("These donors were added on");
  await expect(page.getByRole("button", { name: /^Add these/ })).toHaveCount(0);
});

test("a report's donors can be turned down, and a report that couldn't be read tried again", async ({ page }) => {
  const s = stamp();
  const ready = await readReport(`E2E NGO A ${s}`, "ready", [donor(`E2E Report Maybe ${s} Ltd`, "company")]);
  const failed = await readReport(`E2E NGO B ${s}`, "failed", [], "The link doesn't lead to a PDF.");

  await signInAs(page, "Associate");
  await page.goto(`/leads/donors/reports/${ready}`);
  await page.getByRole("button", { name: "Don't add them" }).click();
  await expect(page.getByRole("status").filter({ hasText: "The report's donors weren't added." })).toBeVisible();
  await page.goto(`/leads/donors/reports/${ready}`);
  await expect(page.getByRole("main")).toContainText("chose not to add these donors");
  await expect(page.getByRole("button", { name: "Add this donor" })).toBeVisible();

  await page.goto(`/leads/donors/reports/${failed}`);
  await expect(page.getByRole("main")).toContainText("Couldn't be read. The link doesn't lead to a PDF.");
  await page.getByRole("button", { name: "Try reading it again" }).click();
  await expect(page.getByRole("status").filter({ hasText: "The portal will try to read this report again" })).toBeVisible();
  await expect(page.getByRole("main")).toContainText(/Waiting (to be read|for an Anthropic API key to be read)/);
  await expectNoAxeViolations(page);
});

test("viewers see where the portal looks and what it read, but change nothing", async ({ page }) => {
  const id = await readReport(`E2E NGO V ${stamp()}`, "ready", [donor(`E2E Report Viewer ${stamp()} Ltd`, "company")]);
  await signInAs(page, "Viewer");
  await page.goto("/leads/donors");
  const where = page.getByRole("region", { name: "Where the portal looks" });
  await expect(where.getByRole("row", { name: /Saksham/ }).getByRole("link", { name: /saksham\.org/ })).toBeVisible();
  await expect(where.getByRole("textbox")).toHaveCount(0);
  await expect(where.getByRole("button")).toHaveCount(0);
  await page.goto(`/leads/donors/reports/${id}`);
  await expect(page.getByRole("heading", { level: 2, name: "1 donor to add" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("button")).toHaveCount(0);
  await expectNoAxeViolations(page);
});
