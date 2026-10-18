import {
  can,
  DUE_SOON_WINDOW_DAYS,
  FUNDER_TYPE_LABELS,
  FUNDER_TYPES,
  formatInrShort,
  STUCK_AFTER_DAYS,
  stageLabel,
  TRACK_LABELS,
  TRACKS,
} from "@ve/core";
import { db, funders } from "@ve/db";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import Link from "next/link";
import { EligibilityPill, FitBadge } from "@/components/eligibility-pill";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/authz";
import { deadlineLabel, listCalls } from "@/lib/calendar";
import { formatDate } from "@/lib/format";
import { dueLabel, listPursuits, type PursuitRow, sumWeighted } from "@/lib/pipeline";

export const metadata = { title: "This week" };

export default async function ThisWeekPage() {
  const user = await requireUser();
  const firstName = user.name?.split(" ")[0];
  const header = (
    <PageHeader
      title={firstName ? `Welcome, ${firstName}` : "This week"}
      intro="Your starting point each day: new leads, deadlines, what's due, what has gone quiet, and where the pipeline stands."
    />
  );
  if (!can(user.roles, "pipeline:view")) return header;

  const [rows, newLeads, calls] = await Promise.all([
    listPursuits(),
    can(user.roles, "leads:view")
      ? db
          .select({ id: funders.id, name: funders.name, fitScore: funders.fitScore, fitSummary: funders.fitSummary })
          .from(funders)
          .where(and(eq(funders.type, "company"), eq(funders.eligibility, "eligible"), gte(funders.createdAt, sql`now() - interval '7 days'`)))
          .orderBy(desc(funders.fitScore))
          .limit(5)
      : null,
    can(user.roles, "calendar:view") ? listCalls() : null,
  ]);
  const deadlines = calls?.filter(
    (c) => c.daysLeft !== null && c.daysLeft >= 0 && c.daysLeft <= DUE_SOON_WINDOW_DAYS && !c.skippedReason && c.eligibility !== "not_eligible",
  );
  const open = rows.filter((r) => !r.closed);
  const due = open
    .filter((r) => r.due && r.due !== "later")
    .sort((a, b) => (a.nextActionDue ?? "").localeCompare(b.nextActionDue ?? ""));
  const quiet = open.filter((r) => r.stuck).sort((a, b) => b.daysInStage - a.daysInStage);
  const mine = open.filter((r) => r.ownerId === user.id);
  const byType = FUNDER_TYPES.map((t) => {
    const inType = open.filter((r) => r.funder.type === t);
    return { type: t, count: inType.length, ask: inType.reduce((a, r) => a + (r.askAmount ?? 0), 0), weighted: sumWeighted(inType) };
  }).filter((g) => g.count > 0);

  return (
    <>
      {header}

      {newLeads ? (
        <section aria-labelledby="leads-heading" className="grid gap-3">
          <div>
            <h2 id="leads-heading" className="text-xl font-bold">
              New CSR leads
            </h2>
            <p className="text-sm text-ve-muted">Eligible companies added in the last 7 days, best fit first.</p>
          </div>
          {newLeads.length ? (
            <ul className="grid gap-2">
              {newLeads.map((f) => (
                <li key={f.id} className="flex items-start gap-3 rounded-md border border-ve-line bg-white p-3">
                  <FitBadge score={f.fitScore} />
                  <div>
                    <Link href={`/funders/${f.id}`} className="font-medium">
                      {f.name}
                    </Link>
                    <p className="text-sm">{f.fitSummary}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-ve-muted">No new eligible companies this week.</p>
          )}
          <p>
            <Link href="/leads?new=1">See all new leads</Link>
          </p>
        </section>
      ) : null}

      {deadlines ? (
        <section aria-labelledby="deadlines-heading" className="grid gap-3">
          <div>
            <h2 id="deadlines-heading" className="text-xl font-bold">
              Award and grant deadlines <span className="text-base font-normal text-ve-muted">({deadlines.length})</span>
            </h2>
            <p className="text-sm text-ve-muted">Calls closing in the next {DUE_SOON_WINDOW_DAYS} days that VE hasn&apos;t ruled out.</p>
          </div>
          {deadlines.length ? (
            <ul className="grid gap-2">
              {deadlines.map((c) => (
                <li key={c.id} className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-ve-line bg-white p-3">
                  <div>
                    <p>
                      <Link href={`/calendar/${c.id}`} className="font-medium">
                        {c.title}
                      </Link>{" "}
                      <span className="text-sm text-ve-muted">· {c.funder.name}</span>
                    </p>
                    <p>
                      <span className={c.daysLeft! <= 7 ? "font-medium text-bad" : ""}>{deadlineLabel(c.daysLeft)}</span>
                      <span className="text-sm text-ve-muted">
                        {" "}
                        · {formatDate(c.deadline)} · {c.application ? `Application ${stageLabel(c.application.stage).toLowerCase()}` : "No application yet"}
                      </span>
                    </p>
                  </div>
                  <EligibilityPill verdict={c.eligibility} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-ve-muted">No deadlines in the next two weeks.</p>
          )}
          <p>
            <Link href="/calendar">See the awards calendar</Link>
          </p>
        </section>
      ) : null}

      <section aria-labelledby="glance-heading" className="grid gap-3">
        <h2 id="glance-heading" className="text-xl font-bold">
          Pipeline at a glance
        </h2>
        <ul className="grid gap-3 sm:grid-cols-3">
          {TRACKS.map((t) => {
            const inTrack = open.filter((r) => r.track === t);
            return (
              <li key={t} className="rounded-lg border border-ve-line bg-white p-4">
                <p className="label text-xs text-ve-muted">{TRACK_LABELS[t]}, weighted</p>
                <p className="text-2xl font-bold">{formatInrShort(sumWeighted(inTrack)) || "₹0"}</p>
                <p className="text-sm text-ve-muted">
                  {inTrack.length} open {inTrack.length === 1 ? "pursuit" : "pursuits"} ·{" "}
                  <Link href={t === "relationship" ? "/pipeline" : `/pipeline?track=${t}`}>
                    See the board<span className="sr-only">: {TRACK_LABELS[t]}</span>
                  </Link>
                </p>
              </li>
            );
          })}
          <li className="rounded-lg border border-ve-line bg-white p-4">
            <p className="label text-xs text-ve-muted">Total asked, open</p>
            <p className="text-2xl font-bold">{formatInrShort(open.reduce((a, r) => a + (r.askAmount ?? 0), 0)) || "₹0"}</p>
            <p className="text-sm text-ve-muted">Weighted means the ask times the chance of winning at its stage.</p>
          </li>
        </ul>
        {byType.length ? (
          <div className="relative overflow-x-auto rounded-lg border border-ve-line bg-white">
            <table className="w-full min-w-[32rem] text-left text-sm">
              <caption className="px-3 pt-3 text-left font-medium">By type of funder</caption>
              <thead>
                <tr className="border-b border-ve-line">
                  <th scope="col" className="label px-3 py-2 text-xs text-ve-muted">Funder type</th>
                  <th scope="col" className="label px-3 py-2 text-right text-xs text-ve-muted">Open pursuits</th>
                  <th scope="col" className="label px-3 py-2 text-right text-xs text-ve-muted">Asked</th>
                  <th scope="col" className="label px-3 py-2 text-right text-xs text-ve-muted">Weighted</th>
                </tr>
              </thead>
              <tbody>
                {byType.map((g) => (
                  <tr key={g.type} className="border-t border-ve-line">
                    <th scope="row" className="px-3 py-2 font-medium">{FUNDER_TYPE_LABELS[g.type]}</th>
                    <td className="px-3 py-2 text-right">{g.count}</td>
                    <td className="px-3 py-2 text-right">{formatInrShort(g.ask) || "₹0"}</td>
                    <td className="px-3 py-2 text-right">{formatInrShort(g.weighted) || "₹0"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        <PursuitList
          id="due"
          title="Next actions due"
          intro={`Overdue, or due in the next ${DUE_SOON_WINDOW_DAYS} days.`}
          empty="Nothing due in the next two weeks."
          rows={due}
          detail={(r) => (
            <>
              {r.nextAction}{" "}
              <span className={`text-sm ${r.due === "overdue" ? "font-medium text-bad" : "text-ve-muted"}`}>{dueLabel(r)}</span>
            </>
          )}
        />
        <PursuitList
          id="quiet"
          title="Gone quiet"
          intro={`Open pursuits that haven't changed stage in more than ${STUCK_AFTER_DAYS} days.`}
          empty="Nothing has gone quiet."
          rows={quiet}
          detail={(r) => (
            <>
              {r.daysInStage} days at {stageLabel(r.stage)}
            </>
          )}
        />
      </div>

      <PursuitList
        id="mine"
        title="Your pursuits"
        empty="You don't own any open pursuits."
        rows={mine}
        detail={(r) => (
          <>
            {stageLabel(r.stage)}
            {r.nextAction ? <span className="text-ve-muted"> · Next: {r.nextAction}</span> : null}
          </>
        )}
      />
    </>
  );
}

function PursuitList({
  id,
  title,
  intro,
  empty,
  rows,
  detail,
}: {
  id: string;
  title: string;
  intro?: string;
  empty: string;
  rows: PursuitRow[];
  detail: (r: PursuitRow) => React.ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-heading`} className="grid content-start gap-3">
      <div>
        <h2 id={`${id}-heading`} className="text-xl font-bold">
          {title} <span className="text-base font-normal text-ve-muted">({rows.length})</span>
        </h2>
        {intro ? <p className="text-sm text-ve-muted">{intro}</p> : null}
      </div>
      {rows.length ? (
        <ul className="grid gap-2">
          {rows.map((r) => (
            <li key={r.id} className="rounded-md border border-ve-line bg-white p-3">
              <p>
                <Link href={`/pursuits/${r.id}`} className="font-medium">
                  {r.title}
                </Link>{" "}
                <span className="text-sm text-ve-muted">
                  · {r.funder.name}
                  {r.ownerName ? ` · ${r.ownerName}` : ""}
                </span>
              </p>
              <p>{detail(r)}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-ve-muted">{empty}</p>
      )}
    </section>
  );
}
