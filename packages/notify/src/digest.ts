import {
  addDays,
  ALL_STAGES,
  daysBetween,
  daysUntil,
  DUE_SOON_WINDOW_DAYS,
  formatInrShort,
  HIGH_FIT_SCORE,
  isClosed,
  isLost,
  isStuck,
  STUCK_AFTER_DAYS,
  stageLabel,
} from "@ve/core";
import { db, funders, opportunities, pursuits, pursuitStageChanges, users } from "@ve/db";
import { and, desc, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { queueEmail } from "./outbox";
import { loadPeople } from "./people";
import { appUrl, daysLeftLabel, escapeHtml, formatDay, layout, link, type Section, settingsFooter } from "./templates";

const WON_STAGES = ALL_STAGES.filter((s) => isClosed(s) && !isLost(s));

/** Monday of the week `day` falls in. */
export function weekStart(day: string): string {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
  return addDays(day, -((dow + 6) % 7));
}

/**
 * The weekly digest from the PRD: new high-fit leads, deadlines this fortnight, pursuits stuck for
 * more than 21 days, and wins. Everyone who can see the pipeline gets it unless they turned it off.
 * A week with nothing in any section sends nothing. Returns how many emails were queued.
 */
export async function queueWeeklyDigest(today: string, log: (m: string) => void = console.log): Promise<number> {
  const base = appUrl();
  const now = new Date(`${today}T08:00:00+05:30`);

  const [leads, deadlines, open, wins] = await Promise.all([
    db
      .select({ id: funders.id, name: funders.name, fitScore: funders.fitScore, fitSummary: funders.fitSummary })
      .from(funders)
      .where(
        and(
          eq(funders.type, "company"),
          eq(funders.eligibility, "eligible"),
          gte(funders.fitScore, HIGH_FIT_SCORE),
          gte(funders.createdAt, sql`${now.toISOString()}::timestamptz - interval '7 days'`),
        ),
      )
      .orderBy(desc(funders.fitScore))
      .limit(10),
    db
      .select({ id: opportunities.id, title: opportunities.title, deadline: opportunities.deadline, organiser: funders.name })
      .from(opportunities)
      .innerJoin(funders, eq(funders.id, opportunities.funderId))
      .where(
        and(
          gte(opportunities.deadline, today),
          lte(opportunities.deadline, addDays(today, DUE_SOON_WINDOW_DAYS)),
          isNull(opportunities.skippedReason),
          ne(opportunities.eligibility, "not_eligible"),
        ),
      )
      .orderBy(opportunities.deadline),
    db
      .select({ id: pursuits.id, title: pursuits.title, stage: pursuits.stage, stageChangedAt: pursuits.stageChangedAt, funder: funders.name, owner: users.name })
      .from(pursuits)
      .innerJoin(funders, eq(funders.id, pursuits.funderId))
      .leftJoin(users, eq(users.id, pursuits.ownerId)),
    db
      .select({ id: pursuits.id, title: pursuits.title, stage: pursuitStageChanges.toStage, ask: pursuits.askAmount, funder: funders.name })
      .from(pursuitStageChanges)
      .innerJoin(pursuits, eq(pursuits.id, pursuitStageChanges.pursuitId))
      .innerJoin(funders, eq(funders.id, pursuits.funderId))
      .where(and(inArray(pursuitStageChanges.toStage, WON_STAGES), gte(pursuitStageChanges.changedAt, sql`${now.toISOString()}::timestamptz - interval '7 days'`)))
      .orderBy(desc(pursuitStageChanges.changedAt)),
  ]);
  const stuck = open.filter((p) => isStuck(p.stage, p.stageChangedAt, now)).sort((a, b) => a.stageChangedAt.getTime() - b.stageChangedAt.getTime());

  if (!leads.length && !deadlines.length && !stuck.length && !wins.length) {
    log(`Nothing for the weekly digest of ${today}`);
    return 0;
  }

  const sections: Section[] = [
    {
      heading: `New high-fit CSR leads (${leads.length})`,
      empty: "No new eligible companies scored 70 or more this week.",
      items: leads.map((f) => ({
        html: `${link(`${base}/funders/${f.id}`, f.name)}, fit ${f.fitScore} out of 100. ${escapeHtml(f.fitSummary ?? "")}`,
        text: `${f.name}, fit ${f.fitScore} out of 100. ${f.fitSummary ?? ""} ${base}/funders/${f.id}`,
      })),
    },
    {
      heading: `Award and grant deadlines in the next ${DUE_SOON_WINDOW_DAYS} days (${deadlines.length})`,
      empty: "No deadlines in the next two weeks.",
      items: deadlines.map((c) => {
        const when = `closes ${daysLeftLabel(daysUntil(c.deadline!, today))}, ${formatDay(c.deadline!)}`;
        return {
          html: `${link(`${base}/calendar/${c.id}`, c.title)} from ${escapeHtml(c.organiser)}, ${when}`,
          text: `${c.title} from ${c.organiser}, ${when}. ${base}/calendar/${c.id}`,
        };
      }),
    },
    {
      heading: `Stuck for more than ${STUCK_AFTER_DAYS} days (${stuck.length})`,
      empty: "Nothing has gone quiet.",
      items: stuck.map((p) => {
        const days = daysBetween(p.stageChangedAt, now);
        const detail = `${p.funder}, ${stageLabel(p.stage)} for ${days} days${p.owner ? `, owner ${p.owner}` : ""}`;
        return { html: `${link(`${base}/pursuits/${p.id}`, p.title)}: ${escapeHtml(detail)}`, text: `${p.title}: ${detail}. ${base}/pursuits/${p.id}` };
      }),
    },
    {
      heading: `Wins this week (${wins.length})`,
      empty: "No wins recorded this week.",
      items: wins.map((w) => {
        const detail = `${w.funder}, ${stageLabel(w.stage)}${w.ask ? `, ${formatInrShort(w.ask)}` : ""}`;
        return { html: `${link(`${base}/pursuits/${w.id}`, w.title)}: ${escapeHtml(detail)}`, text: `${w.title}: ${detail}. ${base}/pursuits/${w.id}` };
      }),
    },
  ];
  const title = `VE funding, week of ${formatDay(weekStart(today))}`;
  const { html, text } = layout({
    title,
    intro: `What changed in the pipeline this week. ${link(`${base}/`, "Open This week in the portal")} for the full picture.`,
    sections,
    footer: settingsFooter("You get this weekly digest because you can see VE's pipeline."),
  });
  const counts = [
    leads.length ? `${leads.length} new ${leads.length === 1 ? "lead" : "leads"}` : null,
    deadlines.length ? `${deadlines.length} ${deadlines.length === 1 ? "deadline" : "deadlines"}` : null,
    stuck.length ? `${stuck.length} stuck` : null,
    wins.length ? `${wins.length} ${wins.length === 1 ? "win" : "wins"}` : null,
  ].filter(Boolean);

  const people = (await loadPeople()).filter((p) => p.digestEmails && p.can("pipeline:view"));
  let queued = 0;
  for (const person of people) {
    const isNew = await queueEmail({
      kind: "digest",
      dedupeKey: `digest:${weekStart(today)}:${person.id}`,
      toUserId: person.id,
      toEmail: person.email,
      subject: `${title}: ${counts.join(", ")}`,
      html,
      text,
    });
    if (isNew) queued++;
  }
  log(`Queued ${queued} weekly digests for the week of ${weekStart(today)}`);
  return queued;
}
