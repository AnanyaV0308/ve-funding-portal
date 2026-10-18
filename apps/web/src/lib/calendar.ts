import "server-only";
import { type CallStatus, callStatus, daysUntil, type Stage } from "@ve/core";
import { db, funders, opportunities, pursuits, users } from "@ve/db";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { todayInIndia } from "./format";

export type CallRow = {
  id: string;
  title: string;
  kind: (typeof opportunities.$inferSelect)["kind"];
  url: string | null;
  opensOn: string | null;
  deadline: string | null;
  usualWindow: string | null;
  amount: number | null;
  amountNote: string | null;
  eligibility: (typeof opportunities.$inferSelect)["eligibility"];
  skippedReason: string | null;
  funder: { id: string; name: string };
  status: CallStatus;
  /** Days to the deadline; negative once it has passed. */
  daysLeft: number | null;
  application: { id: string; stage: Stage; ownerName: string | null } | null;
};

/** Every call with where it stands today, soonest deadline first; calls without dates last. */
export async function listCalls(today = todayInIndia()): Promise<CallRow[]> {
  const rows = await db
    .select({
      id: opportunities.id,
      title: opportunities.title,
      kind: opportunities.kind,
      url: opportunities.url,
      opensOn: opportunities.opensOn,
      deadline: opportunities.deadline,
      usualWindow: opportunities.usualWindow,
      amount: opportunities.amount,
      amountNote: opportunities.amountNote,
      eligibility: opportunities.eligibility,
      skippedReason: opportunities.skippedReason,
      funder: { id: funders.id, name: funders.name },
    })
    .from(opportunities)
    .innerJoin(funders, eq(funders.id, opportunities.funderId))
    .orderBy(sql`${opportunities.deadline} asc nulls last`, asc(opportunities.title));
  const apps = rows.length
    ? await db
        .select({ id: pursuits.id, opportunityId: pursuits.opportunityId, stage: pursuits.stage, ownerName: users.name, createdAt: pursuits.createdAt })
        .from(pursuits)
        .leftJoin(users, eq(users.id, pursuits.ownerId))
        .where(inArray(pursuits.opportunityId, rows.map((r) => r.id)))
        .orderBy(asc(pursuits.createdAt))
    : [];
  return rows.map((r) => {
    const app = apps.find((a) => a.opportunityId === r.id);
    return {
      ...r,
      status: callStatus(r, today),
      daysLeft: r.deadline ? daysUntil(r.deadline, today) : null,
      application: app ? { id: app.id, stage: app.stage, ownerName: app.ownerName } : null,
    };
  });
}

/** The weeks of a month as rows of seven YYYY-MM-DD dates (Monday first), null outside the month. */
export function monthGrid(month: string): (string | null)[][] {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 1, 1));
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7;
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= days; d++) cells.push(`${month}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** "2026-11" moved by a number of months. */
export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

const monthFmt = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

export function monthLabel(month: string): string {
  return monthFmt.format(new Date(`${month}-01T00:00:00Z`));
}

/** "Closes in 12 days", "Closes today", "Closed 3 days ago". */
export function deadlineLabel(daysLeft: number | null): string {
  if (daysLeft === null) return "No deadline yet";
  if (daysLeft < 0) return daysLeft === -1 ? "Closed yesterday" : `Closed ${-daysLeft} days ago`;
  if (daysLeft === 0) return "Closes today";
  if (daysLeft === 1) return "Closes tomorrow";
  return `Closes in ${daysLeft} days`;
}

/** Funders who can run a call: anyone who isn't a CSR company, plus companies already running one. */
export async function listOrganisers(): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: funders.id, name: funders.name })
    .from(funders)
    .where(sql`${funders.type} <> 'company' or ${funders.id} in (select ${opportunities.funderId} from ${opportunities})`)
    .orderBy(asc(funders.name));
}
