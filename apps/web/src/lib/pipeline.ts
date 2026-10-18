import "server-only";
import {
  daysBetween,
  dueState,
  effectiveProbability,
  isClosed,
  isStuck,
  STAGES_BY_TRACK,
  type Track,
  weightedValue,
} from "@ve/core";
import { db, pursuits } from "@ve/db";
import { and, desc, eq, type SQL } from "drizzle-orm";
import { formatDate, todayInIndia } from "./format";

export type PursuitRow = Awaited<ReturnType<typeof listPursuits>>[number];

/** Pursuits with their funder, owner and the numbers every pipeline screen shows, in stage order. */
export async function listPursuits(filter: { track?: Track; ownerId?: string } = {}) {
  const where: SQL[] = [];
  if (filter.track) where.push(eq(pursuits.track, filter.track));
  if (filter.ownerId) where.push(eq(pursuits.ownerId, filter.ownerId));
  const rows = await db.query.pursuits.findMany({
    where: where.length ? and(...where) : undefined,
    orderBy: desc(pursuits.updatedAt),
    with: {
      funder: { columns: { id: true, name: true, type: true } },
      owner: { columns: { id: true, name: true, email: true } },
    },
  });
  const now = new Date();
  const today = todayInIndia(now);
  const order = (r: (typeof rows)[number]) => STAGES_BY_TRACK[r.track].indexOf(r.stage);
  return rows
    .map((p) => {
      const probability = effectiveProbability(p.stage, p.probabilityOverride);
      const closed = isClosed(p.stage);
      return {
        ...p,
        ownerName: p.owner?.name ?? p.owner?.email ?? null,
        probability,
        weighted: weightedValue(p.askAmount, probability),
        closed,
        daysInStage: daysBetween(p.stageChangedAt, now),
        stuck: isStuck(p.stage, p.stageChangedAt, now),
        due: p.nextActionDue && !closed ? dueState(p.nextActionDue, today) : null,
      };
    })
    .sort((a, b) => (a.track === b.track ? order(a) - order(b) : a.track.localeCompare(b.track)));
}

export function sumWeighted(rows: { weighted: number; closed: boolean }[]): number {
  return rows.filter((r) => !r.closed).reduce((a, r) => a + r.weighted, 0);
}

/** "Due 4 Nov 2026", "Due today" or "Overdue, was due 16 Oct 2026". */
export function dueLabel(r: Pick<PursuitRow, "nextActionDue" | "due">): string | null {
  if (!r.nextActionDue) return null;
  const date = formatDate(r.nextActionDue);
  return r.due === "overdue" ? `Overdue, was due ${date}` : r.due === "today" ? "Due today" : `Due ${date}`;
}
