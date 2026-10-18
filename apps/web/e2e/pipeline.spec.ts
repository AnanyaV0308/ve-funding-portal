import { expect, type Page, test } from "@playwright/test";
import { withSql } from "./db";
import { expectNoAxeViolations, signInAs } from "./helpers";

// Records made here start with "E2E" so they can be told apart from the demo data and cleaned up.
const stamp = () => `${Date.now()}-${Math.floor(Math.random() * 1000)}`;

async function makePursuit(opts: { stage?: string; daysInStage?: number; dueInDays?: number; ownerEmail?: string } = {}) {
  const s = stamp();
  const title = `E2E pursuit ${s}`;
  const id = await withSql(async (sql) => {
    const [f] = await sql`insert into funders (name, type) values (${`E2E funder ${s}`}, 'company') returning id`;
    const owner = opts.ownerEmail ? (await sql`select id from users where email = ${opts.ownerEmail}`)[0]?.id : null;
    const [p] = await sql`
      insert into pursuits (funder_id, title, track, stage, stage_changed_at, owner_id, ask_amount, next_action, next_action_due)
      values (
        ${f!.id}, ${title}, 'relationship', ${opts.stage ?? "identified"},
        now() - make_interval(days => ${opts.daysInStage ?? 0}), ${owner ?? null}, 2000000,
        ${opts.dueInDays === undefined ? null : "Call the CSR head"},
        ${opts.dueInDays === undefined ? null : sql`(now() at time zone 'Asia/Kolkata')::date + ${opts.dueInDays}::int`}
      )
      returning id`;
    await sql`insert into pursuit_stage_changes (pursuit_id, to_stage) values (${p!.id}, ${opts.stage ?? "identified"})`;
    return p!.id as string;
  });
  return { id, title };
}

test.afterAll(async () => {
  await withSql(async (sql) => {
    await sql`delete from pursuits where funder_id in (select id from funders where name like 'E2E %')`;
    await sql`delete from funders where name like 'E2E %'`;
  });
});

const column = (page: Page, name: string) =>
  page.getByRole("region", { name: "Pipeline board" }).getByRole("region", { name: new RegExp(`^${name} \\d+`) });

test("an associate adds a pursuit for a new funder, moves it and logs a call", async ({ page }) => {
  const s = stamp();
  const title = `E2E STEM labs ${s}`;
  await signInAs(page, "Associate");
  await page.goto("/pipeline");
  await page.getByRole("link", { name: "Add a pursuit" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Add a pursuit" })).toBeVisible();
  await expectNoAxeViolations(page);

  await page.getByRole("button", { name: "Add pursuit" }).click();
  await expect(page.getByText("Choose a funder or add a new one")).toBeVisible();

  await page.getByLabel("Funder", { exact: true }).selectOption({ label: "Add a new funder…" });
  await page.getByLabel("New funder's name").fill(`E2E funder ${s}`);
  await page.getByLabel("Type").selectOption({ label: "Company (CSR)" });
  await page.getByLabel("What VE is asking for").fill(title);
  await page.getByLabel("Ask (optional)").fill("lots");
  await page.getByRole("button", { name: "Add pursuit" }).click();
  await expect(page.getByText("Write an amount like 40 lakh")).toBeVisible();
  // What was typed survives the error.
  await expect(page.getByLabel("What VE is asking for")).toHaveValue(title);

  await page.getByLabel("Ask (optional)").fill("25 lakh");
  await page.getByRole("button", { name: "Add pursuit" }).click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Pursuit added." })).toBeFocused();
  await expect(page.getByRole("main")).toContainText("₹25 L");
  await expectNoAxeViolations(page);

  await page.getByLabel("Move to stage").selectOption("contacted");
  await page.getByLabel("Note (optional)").fill("Emailed the CSR head");
  await page.getByRole("button", { name: "Move", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Moved to Contacted." })).toBeVisible();
  const history = page.getByRole("region", { name: "Stage history" });
  await expect(history.getByRole("listitem").first()).toContainText(/Identified.*Contacted/);
  await expect(history.getByRole("listitem").first()).toContainText("Emailed the CSR head");

  await page.getByLabel("Chance of winning, % (optional)").fill("50");
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Details saved." })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("₹12.5 L");
  await expect(page.getByRole("main")).toContainText("50% chance, set by hand");

  const log = page.getByRole("region", { name: "Calls, meetings and notes" });
  await log.getByLabel("What kind").selectOption({ label: "Call" });
  await log.getByLabel("What happened").fill("Spoke to the CSR head; they want a budget by Friday.");
  await log.getByRole("button", { name: "Log it" }).click();
  await expect(log.getByRole("status")).toHaveText("Logged.");
  await expect(log.getByRole("listitem").first()).toContainText("they want a budget by Friday");
  await expect(log.getByLabel("What happened")).toHaveValue("");
});

test("cards move on the board with the Stage menu and by dragging", async ({ page }) => {
  const { id, title } = await makePursuit();
  await signInAs(page, "Associate");
  await page.goto("/pipeline");
  await expect(column(page, "Identified").getByRole("heading", { name: title })).toBeVisible();
  await expectNoAxeViolations(page);

  await page.getByLabel(`Stage for ${title}`).selectOption("qualified");
  await page.getByRole("button", { name: `Move ${title}` }).click();
  await expect(page.getByRole("status")).toHaveText(`Moved ${title} to Qualified.`);
  await expect(column(page, "Qualified").getByRole("heading", { name: title })).toBeVisible();
  await expect(page.locator(`#card-${id}`)).toBeFocused();

  // Drag by the card's funder line, away from its links and menus.
  const handle = page.getByRole("article", { name: title }).getByText(/^E2E funder/);
  const target = (await column(page, "Intro requested").boundingBox())!;
  await handle.hover();
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + 60, { steps: 10 });
  await page.mouse.move(target.x + target.width / 2, target.y + 80, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByRole("status")).toHaveText(`Moved ${title} to Intro requested.`);
  await expect(column(page, "Intro requested").getByRole("heading", { name: title })).toBeVisible();
});

test("closing a pursuit as lost asks for a reason", async ({ page }) => {
  const { title } = await makePursuit({ stage: "qualified" });
  await signInAs(page, "Associate");
  await page.goto("/pipeline");
  await page.getByLabel(`Stage for ${title}`).selectOption("not_now");
  await page.getByRole("button", { name: `Move ${title}` }).click();

  await expect(page).toHaveURL(/close=not_now/);
  const heading = page.getByRole("heading", { name: "Move to “Not now or lost”" });
  await expect(heading).toBeFocused();
  await expectNoAxeViolations(page);
  await page.getByLabel("Reason").fill("CSR budget for this year is already committed.");
  await page.getByLabel("Try again from (optional)").fill("2027-04-01");
  await page.getByRole("button", { name: "Move to Not now or lost" }).click();

  await expect(page.getByRole("status").filter({ hasText: "Moved to Not now or lost." })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("CSR budget for this year is already committed.");
  await expect(page.getByRole("main")).toContainText("Try again from 1 Apr 2027");
});

test("the table view shows the same pursuits, on both tracks", async ({ page }) => {
  await signInAs(page, "Viewer");
  await page.goto("/pipeline");
  await page.getByRole("link", { name: "Table" }).click();
  const row = page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "Accessible science labs" }) });
  await expect(row).toContainText("Example: Narmada Steel");
  await expect(row).toContainText("In conversation");
  await expect(row).toContainText("Overdue");
  await expectNoAxeViolations(page);

  await page.getByRole("navigation", { name: "Pipeline tracks" }).getByRole("link", { name: "Applications" }).click();
  await expect(page.getByRole("rowheader", { name: "Best NGO in assistive technology" })).toBeVisible();
  await expect(page.getByRole("rowheader", { name: "Accessible science labs" })).toHaveCount(0);
});

test("viewers can see the pipeline but not change it", async ({ page }) => {
  await signInAs(page, "Viewer");
  await page.goto("/pipeline");
  await expect(page.getByRole("heading", { name: "STEM labs in Karnataka, FY27" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Add a pursuit" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Move / })).toHaveCount(0);

  await page.getByRole("link", { name: "STEM labs in Karnataka, FY27" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "STEM labs in Karnataka, FY27" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("button")).toHaveCount(0);
  await expectNoAxeViolations(page);

  await page.goto("/pursuits/new");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("You can't open this page");
});

test("This week shows what's due, what has gone quiet and my pursuits", async ({ page }) => {
  const { title } = await makePursuit({ stage: "in_conversation", daysInStage: 30, dueInDays: -1, ownerEmail: "associate@demo.visionempower.local" });
  await signInAs(page, "Associate");
  await expect(page.getByRole("heading", { level: 1, name: "Welcome, Demo" })).toBeVisible();
  const due = page.getByRole("region", { name: /^Next actions due/ });
  await expect(due.getByRole("listitem").filter({ hasText: title })).toContainText("Overdue");
  await expect(page.getByRole("region", { name: /^Gone quiet/ }).getByRole("listitem").filter({ hasText: title })).toContainText("30 days at In conversation");
  await expect(page.getByRole("region", { name: /^Your pursuits/ })).toContainText(title);
  await expect(page.getByRole("region", { name: "Pipeline at a glance" })).toContainText("Relationships, weighted");
  await expectNoAxeViolations(page);
});

test("wide tables scroll inside themselves, so the page never scrolls sideways", async ({ page }) => {
  await signInAs(page, "Associate");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/pipeline", "/pipeline?view=table", "/", "/leads", "/leads/import", "/calendar", "/calendar?view=month", "/settings"]) {
      await page.goto(path);
      expect(await page.evaluate(() => document.documentElement.scrollWidth), `${path} at ${width}px`).toBeLessThanOrEqual(width);
    }
  }
});
