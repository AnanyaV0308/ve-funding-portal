import { execSync } from "node:child_process";
import { expect, type Page, test } from "@playwright/test";
import { withSql } from "./db";
import { expectNoAxeViolations, signInAs } from "./helpers";

// Records made here start with "E2E" so they can be told apart from the demo data and cleaned up.
const stamp = () => `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
const indiaDay = (inDays: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(Date.now() + inDays * 86_400_000));

async function makeCall(opts: { deadlineInDays?: number } = {}) {
  const s = stamp();
  const title = `E2E call ${s}`;
  const id = await withSql(async (sql) => {
    const [f] = await sql`insert into funders (name, type) values (${`E2E organiser ${s}`}, 'award_body') returning id`;
    const [o] = await sql`
      insert into opportunities (funder_id, kind, title, deadline)
      values (${f!.id}, 'grant', ${title}, ${opts.deadlineInDays === undefined ? null : indiaDay(opts.deadlineInDays)})
      returning id`;
    return o!.id as string;
  });
  return { id, title };
}

test.afterAll(async () => {
  await withSql(async (sql) => {
    const calls = sql`select id from opportunities where title like 'E2E %'`;
    await sql`delete from outbound_emails where opportunity_id in (${calls})`;
    await sql`delete from pursuits where opportunity_id in (${calls})`;
    await sql`delete from opportunities where title like 'E2E %'`;
    await sql`delete from funders where name like 'E2E %' and id not in (select funder_id from pursuits)`;
  });
});

const checklist = (page: Page) => page.getByRole("region", { name: "Eligibility checklist" });

test("an associate adds a call, checks eligibility, gets a reminder and starts an application", async ({ page }) => {
  const s = stamp();
  const title = `E2E Inclusive classrooms grant ${s}`;
  const deadline = indiaDay(10);
  await signInAs(page, "Associate");
  await page.goto("/calendar");
  await expectNoAxeViolations(page);
  await page.getByRole("link", { name: "Add a call" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Add an award or grant call" })).toBeVisible();
  await expectNoAxeViolations(page);

  await page.getByRole("button", { name: "Add call" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Some fields need fixing.");

  await page.getByLabel("Organiser", { exact: true }).selectOption({ label: "Add a new organiser…" });
  await page.getByLabel("New organiser's name").fill(`E2E organiser ${s}`);
  await page.getByLabel("Name of the call").fill(title);
  await page.getByLabel("Kind").selectOption({ label: "Grant" });
  await page.getByLabel("Deadline (optional)").fill(deadline);
  await page.getByLabel("Opens on (optional)").fill(indiaDay(12));
  await page.getByLabel("Prize or grant (optional)").fill("lots");
  await page.getByRole("button", { name: "Add call" }).click();
  await expect(page.getByText("Write an amount like 5 lakh")).toBeVisible();
  // What was typed survives the error.
  await expect(page.getByLabel("Name of the call")).toHaveValue(title);
  await page.getByLabel("Prize or grant (optional)").fill("8 lakh");
  await page.getByRole("button", { name: "Add call" }).click();
  await expect(page.getByText("The deadline can't be before the call opens")).toBeVisible();
  await page.getByLabel("Opens on (optional)").fill("");
  await page.getByRole("button", { name: "Add call" }).click();

  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Call added." })).toBeVisible();
  await expect(checklist(page)).toContainText("Nobody has checked this call yet.");
  await expectNoAxeViolations(page);

  // One "not sure" keeps it at needs check; all yes makes it eligible.
  const groups = checklist(page).getByRole("group");
  await expect(groups).toHaveCount(6);
  for (const group of await groups.all()) await group.getByRole("radio", { name: "VE meets it" }).check();
  await groups.first().getByRole("radio", { name: "Not sure" }).check();
  await checklist(page).getByRole("button", { name: "Save checklist" }).click();
  await expect(checklist(page).getByRole("status")).toHaveText("Checklist saved. This call is now marked needs check.");
  await groups.first().getByRole("radio", { name: "VE meets it" }).check();
  await checklist(page).getByRole("button", { name: "Save checklist" }).click();
  await expect(checklist(page).getByRole("status")).toHaveText("Checklist saved. This call is now marked eligible.");

  // The daily reminder job catches up with the 14-day reminder, once.
  // Tests run from apps/web.
  const root = "../..";
  execSync("pnpm --filter @ve/notify reminders", { cwd: root, stdio: "pipe" });
  execSync("pnpm --filter @ve/notify reminders", { cwd: root, stdio: "pipe" });
  const emails = await withSql(
    (sql) =>
      sql`select e.subject, e.dedupe_key from outbound_emails e join opportunities o on o.id = e.opportunity_id where o.title = ${title} and e.to_email = 'associate@demo.visionempower.local'`,
  );
  expect(emails.map((e) => e.subject)).toEqual([`Closes in 10 days: ${title}`]);
  await page.reload();
  const reminders = page.getByRole("region", { name: "Reminders" });
  await expect(reminders.getByRole("listitem").filter({ hasText: "14 days before" })).toContainText(/Sent to \d+ (person|people)/);
  await expect(reminders.getByRole("listitem").filter({ hasText: "7 days before" })).toContainText("Not yet due");

  // It shows on the calendar and on This week.
  await page.goto("/calendar");
  const row = page
    .getByRole("region", { name: /^Open now/ })
    .getByRole("row")
    .filter({ hasText: title });
  await expect(row).toContainText("Not started");
  await expect(row).toContainText("₹8 L");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "This week" }).click();
  await expect(
    page
      .getByRole("region", { name: /^Award and grant deadlines/ })
      .getByRole("listitem")
      .filter({ hasText: title }),
  ).toContainText("Closes in 10 days");

  await page.goto("/calendar");
  await row.getByRole("link", { name: title }).click();
  await page.getByRole("button", { name: "Start an application" }).click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Pursuit added." })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("For the call");
  await page.getByRole("link", { name: title }).last().click();
  await expect(page.getByRole("link", { name: "Open the application" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Not applying?" })).toHaveCount(0);
});

test("a call VE won't apply for can be skipped and brought back", async ({ page }) => {
  const call = await makeCall({ deadlineInDays: 20 });
  await signInAs(page, "Associate");
  await page.goto(`/calendar/${call.id}`);
  await page.getByRole("link", { name: "Edit details" }).click();
  await expect(page.getByLabel("Name of the call")).toHaveValue(call.title);
  await page.getByLabel("About the money (optional)").fill("Small grants only");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Changes saved." })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Small grants only");

  const skip = page.getByRole("region", { name: "Not applying?" });
  await skip.getByRole("button", { name: "Skip this call" }).click();
  await expect(skip.getByText("Say why VE is skipping it")).toBeVisible();
  await skip.getByLabel("Why skip it?").fill("E2E: below the ₹5 lakh floor");
  await skip.getByRole("button", { name: "Skip this call" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Skipped." })).toBeVisible();
  await expect(page.getByRole("region", { name: "Reminders" })).toContainText("No reminders go out, because VE skipped this call.");

  await page.goto("/calendar");
  await expect(page.getByRole("link", { name: call.title })).toHaveCount(0);
  await page.getByLabel("Calls VE skipped").check();
  await page.getByRole("button", { name: "Show calls" }).click();
  await expect(page.getByRole("row").filter({ hasText: call.title })).toContainText("below the ₹5 lakh floor");

  await page.getByRole("link", { name: call.title }).click();
  await page.getByRole("button", { name: "Undo skip" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Back on the calendar." })).toBeVisible();
  await expect(page.getByRole("region", { name: "Not applying?" })).toBeVisible();
});

test("the month view shows deadlines in a grid and as a list", async ({ page }) => {
  const call = await makeCall({ deadlineInDays: 40 });
  const month = (await withSql((sql) => sql`select to_char(deadline, 'YYYY-MM') as m from opportunities where id = ${call.id}`))[0]!.m as string;
  await signInAs(page, "Viewer");
  await page.goto("/calendar");
  await page.getByRole("navigation", { name: "Calendar view" }).getByRole("link", { name: "Month" }).click();
  await expect(page.getByRole("link", { name: "Month" })).toHaveAttribute("aria-current", "true");
  await expect(page.locator('td[aria-current="date"]')).toHaveCount(1);
  await expectNoAxeViolations(page);

  await page.goto(`/calendar?view=month&month=${month}`);
  await expect(page.getByRole("table").getByRole("link", { name: call.title })).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: /^Everything in/ })
      .getByRole("listitem")
      .filter({ hasText: call.title }),
  ).toContainText("Deadline for");
  await expectNoAxeViolations(page);
});

test("viewers can read the calendar but not change it", async ({ page }) => {
  const call = await makeCall({ deadlineInDays: 5 });
  await signInAs(page, "Viewer");
  await page.goto("/calendar");
  await expect(page.getByRole("link", { name: "Add a call" })).toHaveCount(0);
  await page.goto(`/calendar/${call.id}`);
  await expect(page.getByRole("heading", { level: 1, name: call.title })).toBeVisible();
  await expect(checklist(page)).toContainText("Not checked yet");
  for (const name of ["Save checklist", "Start an application", "Skip this call"]) await expect(page.getByRole("button", { name })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Edit details" })).toHaveCount(0);
  await expectNoAxeViolations(page);
  await page.goto("/calendar/new");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("You can't open this page");
});
