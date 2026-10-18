import {
  addDays,
  CALL_KIND_LABELS,
  daysUntil,
  dueReminder,
  ELIGIBILITY_LABELS,
  REMINDER_DAYS,
  stageLabel,
  stillNeedsReminders,
} from "@ve/core";
import { db, funders, opportunities, pursuits } from "@ve/db";
import { and, eq, gte, inArray, isNull, lte, ne } from "drizzle-orm";
import { queueEmail } from "./outbox";
import { loadPeople, type Person } from "./people";
import { appUrl, daysLeftLabel, escapeHtml, formatDay, layout, link, settingsFooter } from "./templates";

/**
 * Queues the deadline reminders due today (30, 14, 7 and 2 days before). A call with an
 * application in progress reminds its owner; one nobody has picked up yet reminds everyone who
 * works on the calendar. Skipped calls, calls VE isn't eligible for and applications already
 * submitted get none. Returns how many emails were queued.
 */
export async function queueDeadlineReminders(today: string, log: (m: string) => void = console.log): Promise<number> {
  const calls = await db
    .select({
      id: opportunities.id,
      title: opportunities.title,
      kind: opportunities.kind,
      deadline: opportunities.deadline,
      eligibility: opportunities.eligibility,
      url: opportunities.url,
      organiser: funders.name,
    })
    .from(opportunities)
    .innerJoin(funders, eq(funders.id, opportunities.funderId))
    .where(
      and(
        gte(opportunities.deadline, today),
        lte(opportunities.deadline, addDays(today, REMINDER_DAYS[0])),
        isNull(opportunities.skippedReason),
        ne(opportunities.eligibility, "not_eligible"),
      ),
    );
  if (!calls.length) return 0;

  const apps = await db
    .select({ id: pursuits.id, opportunityId: pursuits.opportunityId, stage: pursuits.stage, ownerId: pursuits.ownerId })
    .from(pursuits)
    .where(inArray(pursuits.opportunityId, calls.map((c) => c.id)));
  const people = await loadPeople();
  const byId = new Map(people.map((p) => [p.id, p]));
  const calendarPeople = people.filter((p) => p.reminderEmails && p.can("calendar:edit"));

  let queued = 0;
  for (const call of calls) {
    const reminder = dueReminder(call.deadline!, today);
    if (!reminder) continue;
    const linked = apps.filter((a) => a.opportunityId === call.id);
    const active = linked.filter((a) => stillNeedsReminders(a.stage));
    if (linked.length && !active.length) continue;

    const owners = active.map((a) => (a.ownerId ? byId.get(a.ownerId) : undefined)).filter((p): p is Person => Boolean(p?.reminderEmails));
    const recipients = owners.length ? [...new Map(owners.map((p) => [p.id, p])).values()] : calendarPeople;
    const left = daysUntil(call.deadline!, today);
    const app = active[0];
    const appLine = app
      ? `Application: ${stageLabel(app.stage)}${app.ownerId && byId.get(app.ownerId) ? `, owned by ${byId.get(app.ownerId)!.name}` : ", with no owner yet"}.`
      : "Nobody has started an application yet.";

    for (const person of recipients) {
      const callUrl = `${appUrl()}/calendar/${call.id}`;
      const { html, text } = layout({
        title: `${call.title} closes ${daysLeftLabel(left)}`,
        intro: `${escapeHtml(CALL_KIND_LABELS[call.kind])} from ${escapeHtml(call.organiser)}. The deadline is <strong>${formatDay(call.deadline!)}</strong>.`,
        sections: [
          {
            heading: "Where it stands",
            items: [
              { html: escapeHtml(`Eligibility: ${ELIGIBILITY_LABELS[call.eligibility]}.`), text: `Eligibility: ${ELIGIBILITY_LABELS[call.eligibility]}.` },
              { html: escapeHtml(appLine), text: appLine },
              { html: link(callUrl, `Open ${call.title} in the portal`), text: `Open it in the portal: ${callUrl}` },
            ],
          },
        ],
        footer: settingsFooter(
          owners.length
            ? `You get this because you own the application. Reminders go out ${REMINDER_DAYS.join(", ").replace(/, (\d+)$/, " and $1")} days before a deadline.`
            : "You get this because you work on the awards calendar and nobody owns an application for this call yet.",
        ),
      });
      const isNew = await queueEmail({
        kind: "reminder",
        dedupeKey: `reminder:${call.id}:${reminder}:${person.id}`,
        toUserId: person.id,
        toEmail: person.email,
        subject: `Closes ${daysLeftLabel(left)}: ${call.title}`,
        html,
        text,
        opportunityId: call.id,
      });
      if (isNew) queued++;
    }
  }
  log(`Queued ${queued} deadline reminders for ${today}`);
  return queued;
}
