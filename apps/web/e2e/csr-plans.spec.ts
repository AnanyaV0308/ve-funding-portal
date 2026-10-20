import { exec } from "node:child_process";
import { promisify } from "node:util";
import { expect, type Page, test } from "@playwright/test";
import { withSql } from "./db";
import { expectNoAxeViolations, signInAs } from "./helpers";

// Records made here start with "E2E" so they can be told apart from the example data and cleaned up.
const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const unlistedCin = () => `U85110KA2015PTC${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`;

test.afterAll(async () => {
  await withSql(async (sql) => {
    await sql`delete from funders where name like 'E2E %' and id not in (select funder_id from pursuits)`;
    await sql`delete from app_settings where key = 'companies_followed'`;
  });
});

/** An unlisted company with two years of CSR Portal data, spent on education in Maharashtra, which isn't one of VE's states. */
async function unlistedCompany(name: string) {
  return withSql(async (sql) => {
    const [f] = await sql`insert into funders (name, type, cin) values (${name}, 'company', ${unlistedCin()}) returning id`;
    // The same years as the example data, so the two latest years in the data stay the same for other tests.
    for (const [fy, spent] of [
      ["2022-23", 20_000_000],
      ["2023-24", 25_000_000],
    ] as const) {
      await sql`insert into csr_years (funder_id, fy, spent, project_count) values (${f!.id}, ${fy}, ${spent}, 4)`;
      await sql`insert into csr_breakdown (funder_id, fy, kind, name, amount) values
        (${f!.id}, ${fy}, 'sector', 'Education', ${spent}), (${f!.id}, ${fy}, 'state', 'Maharashtra', ${spent})`;
    }
    return f!.id as string;
  });
}

const PLAN_URL = "https://example.com/csr/annual-action-plan-2026-27.pdf";

/** The company's 2026-27 action plan, as the reader would have left it, with the NGO it added. */
async function readPlan(funderId: string, name: string) {
  await withSql(async (sql) => {
    const projects = [
      {
        name: "Assistive technology for visually impaired students",
        area: "Promoting education",
        states: ["Karnataka"],
        amountInr: 4_000_000,
        agency: "Saksham Trust",
        agencyKind: "ngo",
        registration: "CSR00001234",
        ongoing: true,
        disability: true,
        page: 2,
      },
      {
        name: "Rural health camps",
        area: "Health care",
        states: ["Maharashtra"],
        amountInr: 6_000_000,
        agency: `${name} Foundation`,
        agencyKind: "own_foundation",
        registration: null,
        ongoing: false,
        disability: false,
        page: 3,
      },
    ];
    const partners = [
      { name: "Saksham Trust", kind: "ngo", amountInr: 4_000_000, registration: "CSR00001234", page: 2 },
      { name: `${name} Foundation`, kind: "own_foundation", amountInr: 6_000_000, registration: null, page: 3 },
    ];
    const leftOut = [{ name: `${name} Foundation`, reason: "own_foundation" }];
    const [p] = await sql`insert into csr_plans (funder_id, origin, url, title, fy, status, budget, policy_url, projects, partners, left_out, pages, read_at)
      values (${funderId}, 'search', ${PLAN_URL}, ${`${name} CSR action plan 2026-27`}, '2026-27', 'read', 30000000, 'https://example.com/csr-policy.pdf',
        ${sql.json(projects)}, ${sql.json(partners)}, ${sql.json(leftOut)}, 4, now())
      returning id`;
    await sql`insert into funder_grantees (funder_id, name, fy, amount, source_label, source_url, csr_plan_id)
      values (${funderId}, 'Saksham Trust', '2026-27', 4000000, ${`${name} CSR action plan 2026-27, page 2`}, ${`${PLAN_URL}#page=2`}, ${p!.id})`;
  });
}

/** Scores the company again the way any edit on its page does. */
async function rescore(page: Page) {
  await page.getByLabel("Warm path").fill("");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("region", { name: "What VE knows" }).getByRole("status")).toHaveText("Saved, and the fit score is up to date.");
}

const fitRow = (page: Page, part: RegExp) => page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: part }) });

test("a read action plan shows its projects, and counts in the fit score", async ({ page }) => {
  const name = `E2E Plan Co ${stamp()}`;
  const id = await unlistedCompany(name);
  await readPlan(id, name);

  await signInAs(page, "Associate");
  await page.goto(`/funders/${id}`);
  await rescore(page);

  // An unlisted company's annual report isn't looked for, but its plan is.
  await expect(page.getByRole("region", { name: "Annual report" })).toContainText("The portal looks only for listed companies' reports on its own");

  const section = page.getByRole("region", { name: "CSR action plan" });
  await expect(section.getByRole("heading", { name: `${name} CSR action plan 2026-27` })).toBeVisible();
  await expect(section.getByRole("definition").first()).toHaveText("₹3 Cr");
  await expect(section.getByRole("definition").nth(1)).toHaveText("2");
  await expect(section.getByRole("definition").nth(2)).toHaveText("Karnataka, Maharashtra");
  await expect(section.getByRole("listitem").filter({ hasText: "Assistive technology for visually impaired students" })).toContainText("₹40 L · Saksham Trust");
  await expect(section.getByRole("link", { name: "page 2 of the plan (opens in a new tab)" }).first()).toHaveAttribute("href", `${PLAN_URL}#page=2`);
  const projects = section.getByRole("table", { name: `Projects in ${name} CSR action plan 2026-27` });
  await expect(projects.getByRole("row")).toHaveCount(3);
  await expect(projects.getByRole("row", { name: /Assistive technology/ })).toContainText("For people with disabilities");
  await expect(projects.getByRole("row", { name: /Rural health camps/ })).toContainText(`${name} Foundation`);
  await expect(section.getByRole("link", { name: "Its CSR policy (opens in a new tab)" })).toHaveAttribute("href", "https://example.com/csr-policy.pdf");
  await expect(section).toContainText("1 NGO it names was added to the NGOs it funds");
  await section.getByText("Left out: 1 organisation").click();
  await expect(section).toContainText(`${name} Foundation · The company's own foundation or trust`);

  // Its disability project counts as cause, its Karnataka project as geography, and its budget is up on 2023-24.
  await expect(fitRow(page, /^Cause/)).toContainText("its FY 2026-27 CSR action plan includes work on disability");
  await expect(fitRow(page, /^Cause/)).toContainText("30 of 30");
  await expect(fitRow(page, /^Geography/)).toContainText("Its FY 2026-27 CSR action plan funds projects in Karnataka");
  await expect(fitRow(page, /^Timing/)).toContainText("FY 2026-27 CSR budget of ₹3 Cr is 20% above FY 2023-24 spend, per its CSR action plan");
  await expect(page.getByRole("region", { name: "NGOs it funds" }).getByRole("link", { name: `${name} CSR action plan 2026-27, page 2` })).toBeVisible();
  await expectNoAxeViolations(page);

  // Removing the plan takes away the NGO it added, and the score with it.
  await section.getByRole("button", { name: `Remove ${name} CSR action plan 2026-27 and the NGOs it added` }).click();
  await expect(section).toContainText("No CSR action plan yet.");
  await expect(fitRow(page, /^Peer NGOs/)).toContainText("0 of 20");
  await expect(fitRow(page, /^Cause/)).not.toContainText("action plan");
  await expect(fitRow(page, /^Geography/)).toContainText("No spend in VE states");
});

test("an associate adds a plan by link or upload, but never from NSE or BSE", async ({ page }) => {
  const name = `E2E Plan Upload Co ${stamp()}`;
  const id = await unlistedCompany(name);
  await signInAs(page, "Associate");
  await page.goto(`/funders/${id}`);
  const section = page.getByRole("region", { name: "CSR action plan" });
  await section.getByText("Add a plan by hand").click();

  const link = section.getByLabel("Link to the plan");
  await link.fill("https://www.bseindia.com/xml-data/corpfiling/AttachLive/e2e-plan.pdf");
  await section.getByRole("button", { name: "Add the link" }).click();
  await expect(section.getByText(/The portal doesn't fetch from NSE or BSE/)).toBeVisible();

  await link.fill("https://example.com/csr/e2e-action-plan.pdf");
  await section.getByRole("button", { name: "Add the link" }).click();
  await expect(section.getByText("Added. The portal will read it in the next few minutes.")).toBeVisible();
  await page.reload();
  await expect(section).toContainText("Waiting for an Anthropic API key to be read");

  await section.getByText("Add a plan by hand").click();
  await section
    .getByLabel("Or upload the PDF")
    .setInputFiles({ name: "e2e-action-plan.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF\n") });
  await section.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(section.getByText("Uploaded. The portal will read it in the next few minutes.")).toBeVisible();
  await expect(section.getByRole("list", { name: "Other CSR action plans" }).getByRole("listitem")).toHaveCount(2);
  await expectNoAxeViolations(page);

  // Without an API key the worker can't look on the web, and says so.
  await section.getByRole("button", { name: "Look for its CSR action plan" }).click();
  await expect(section).toContainText("The portal will look for its plan in the next few minutes.");
  await promisify(exec)("pnpm --filter @ve/ingest csr-plans", { cwd: "../..", env: { ...process.env, ANTHROPIC_API_KEY: "" } });
  await page.reload();
  await expect(section).toContainText("Looking for CSR action plans needs the Anthropic API key, which isn't set up yet.");
});

test("the companies followed page shows each company's plan and report", async ({ page }) => {
  const name = `E2E Followed Plan Co ${stamp()}`;
  const id = await unlistedCompany(name);
  await readPlan(id, name);
  await withSql(async (sql) => {
    await sql`insert into app_settings (key, value) values ('companies_followed', ${sql.json(1000)})
      on conflict (key) do update set value = excluded.value`;
  });

  await signInAs(page, "Associate");
  await page.goto("/leads/followed");
  const row = page.getByRole("row", { name: new RegExp(name) });
  await expect(row.getByRole("cell").nth(1)).toContainText("FY 2026-27");
  await expect(row.getByRole("cell").nth(1)).toContainText("Read");
  await expect(row.getByRole("cell").nth(2)).toContainText("Unlisted, so the portal doesn't look for it");
  await expectNoAxeViolations(page);
});
