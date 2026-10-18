import {
  CALL_KIND_LABELS,
  CALL_STATUS_LABELS,
  can,
  ELIGIBILITY_CHECK_LABELS,
  CHECK_ANSWER_LABELS,
  formatInr,
  normaliseChecklist,
  reminderSchedule,
  stageLabel,
  stillNeedsReminders,
} from "@ve/core";
import { db, opportunities, outboundEmails } from "@ve/db";
import { and, count, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EligibilityPill } from "@/components/eligibility-pill";
import { NoAccess } from "@/components/no-access";
import { Notice } from "@/components/notice";
import { requireUser } from "@/lib/authz";
import { deadlineLabel, listCalls } from "@/lib/calendar";
import { formatDate, todayInIndia } from "@/lib/format";
import { startApplication, unskipCall } from "../actions";
import { ChecklistForm, SkipForm } from "./forms";

type Params = { id: string };
type Search = { created?: string; saved?: string; skipped?: string; unskipped?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function load(id: string) {
  if (!UUID.test(id)) return null;
  return db.query.opportunities.findFirst({
    where: eq(opportunities.id, id),
    with: { checker: { columns: { name: true, email: true } } },
  });
}

export async function generateMetadata({ params }: { params: Promise<Params> }) {
  const call = await load((await params).id);
  return { title: call ? call.title : "Call not found" };
}

export default async function CallPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<Search> }) {
  const user = await requireUser();
  if (!can(user.roles, "calendar:view")) return <NoAccess what="the awards calendar" />;
  const canEdit = can(user.roles, "calendar:edit");
  const canApply = can(user.roles, "pipeline:edit");
  const { id } = await params;
  const search = await searchParams;
  const today = todayInIndia();

  const call = await load(id);
  if (!call) notFound();
  // The same row the calendar shows, so status and application always agree with it.
  const row = (await listCalls(today)).find((c) => c.id === call.id)!;
  const checks = normaliseChecklist(call.checks);
  const sentRows = call.deadline
    ? await db
        .select({ days: sql<string>`split_part(${outboundEmails.dedupeKey}, ':', 3)`, n: count() })
        .from(outboundEmails)
        .where(and(eq(outboundEmails.opportunityId, call.id), eq(outboundEmails.kind, "reminder")))
        .groupBy(sql`1`)
    : [];
  const sentFor = (days: number) => sentRows.find((r) => Number(r.days) === days)?.n ?? 0;

  const noReminders = call.skippedReason
    ? "No reminders go out, because VE skipped this call."
    : call.eligibility === "not_eligible"
      ? "No reminders go out while VE isn't eligible."
      : row.application && !stillNeedsReminders(row.application.stage)
        ? "Reminders have stopped, because the application has gone in."
        : null;

  return (
    <>
      <p>
        <Link href="/calendar">
          <span aria-hidden="true">← </span>Awards calendar
        </Link>
      </p>
      <header className="grid gap-1">
        <h1 className="text-3xl font-bold text-ve-charcoal">{call.title}</h1>
        <p className="text-ve-muted">
          {CALL_KIND_LABELS[call.kind]} · {row.funder.name}
        </p>
      </header>

      {search.created ? <Notice>Call added. Check VE&apos;s eligibility below.</Notice> : null}
      {search.saved ? <Notice>Changes saved.</Notice> : null}
      {search.skipped ? <Notice>Skipped. This call gets no more reminders.</Notice> : null}
      {search.unskipped ? <Notice>Back on the calendar.</Notice> : null}

      <section aria-labelledby="summary-heading" className="grid gap-4 rounded-lg border border-ve-line bg-white p-5">
        <h2 id="summary-heading" className="sr-only">
          Summary
        </h2>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
          <Item term="Deadline">
            {call.deadline ? formatDate(call.deadline) : "Not announced"}
            <span className={`mt-1 block text-sm ${row.daysLeft !== null && row.daysLeft >= 0 && row.daysLeft <= 7 ? "font-medium text-bad" : "text-ve-muted"}`}>
              {call.deadline ? deadlineLabel(row.daysLeft) : CALL_STATUS_LABELS[row.status]}
            </span>
          </Item>
          <Item term="Opens">{call.opensOn ? formatDate(call.opensOn) : "Not set"}</Item>
          <Item term="Prize or grant">
            {call.amount !== null ? formatInr(call.amount) : call.amountNote ? null : "Not set"}
            {call.amountNote ? <span className={call.amount !== null ? "mt-1 block text-sm text-ve-muted" : ""}>{call.amountNote}</span> : null}
          </Item>
          <Item term="Eligibility">
            <EligibilityPill verdict={call.eligibility} />
          </Item>
          <Item term="Application">
            {row.application ? (
              <>
                <Link href={`/pursuits/${row.application.id}`}>{stageLabel(row.application.stage)}</Link>
                <span className="mt-1 block text-sm text-ve-muted">{row.application.ownerName ?? "No owner yet"}</span>
              </>
            ) : call.skippedReason ? (
              <>
                Skipped
                <span className="mt-1 block text-sm text-ve-muted">{call.skippedReason}</span>
              </>
            ) : (
              "Not started"
            )}
          </Item>
          {call.url ? (
            <Item term="Organiser's page">
              <a href={call.url} className="break-all">
                {call.url.replace(/^https?:\/\//, "")}
              </a>
            </Item>
          ) : null}
          {call.usualWindow ? <Item term="When it usually runs">{call.usualWindow}</Item> : null}
          {call.categories ? <Item term="Categories or themes">{call.categories}</Item> : null}
        </dl>
        {call.notes ? <p className="whitespace-pre-line border-t border-ve-line pt-4">{call.notes}</p> : null}

        {canEdit || canApply ? (
          <div className="flex flex-wrap items-center gap-3 border-t border-ve-line pt-4">
            {row.application ? (
              <Link href={`/pursuits/${row.application.id}`} className="btn btn-primary no-underline">
                Open the application
              </Link>
            ) : canApply ? (
              <form action={startApplication}>
                <input type="hidden" name="id" value={call.id} />
                <button type="submit" className="btn btn-primary">
                  Start an application
                </button>
              </form>
            ) : null}
            {canEdit ? (
              <Link href={`/calendar/${call.id}/edit`} className="btn btn-secondary no-underline">
                Edit details
              </Link>
            ) : null}
            {canEdit && call.skippedReason ? (
              <form action={unskipCall}>
                <input type="hidden" name="id" value={call.id} />
                <button type="submit" className="btn btn-secondary">
                  Undo skip
                </button>
              </form>
            ) : null}
          </div>
        ) : null}
      </section>

      <div className="grid gap-8 lg:grid-cols-[3fr_2fr]">
        <section aria-labelledby="checklist-heading" className="grid content-start gap-3">
          <div>
            <h2 id="checklist-heading" className="text-xl font-bold">
              Eligibility checklist
            </h2>
            <ul className="text-sm text-ve-muted">
              {(call.eligibilityReasons ?? []).map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            {call.checkedAt ? (
              <p className="text-sm text-ve-muted">
                Last checked {formatDate(call.checkedAt)}
                {call.checker ? ` by ${call.checker.name ?? call.checker.email}` : ""}.
              </p>
            ) : null}
          </div>
          {canEdit ? (
            <ChecklistForm id={call.id} checks={checks} />
          ) : (
            <dl className="grid gap-2">
              {checks.map((c) => (
                <div key={c.key} className="rounded-md border border-ve-line bg-white p-3">
                  <dt className="font-medium">{ELIGIBILITY_CHECK_LABELS[c.key].label}</dt>
                  <dd>
                    {c.answer ? CHECK_ANSWER_LABELS[c.answer] : "Not checked yet"}
                    {c.note ? <span className="block text-sm text-ve-muted">{c.note}</span> : null}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </section>

        <div className="grid content-start gap-8">
          <section aria-labelledby="reminders-heading" className="grid content-start gap-3">
            <h2 id="reminders-heading" className="text-xl font-bold">
              Reminders
            </h2>
            {!call.deadline ? (
              <p className="text-ve-muted">Reminders start once the call has a deadline.</p>
            ) : (
              <>
                <p className="text-sm text-ve-muted">
                  {noReminders ??
                    (row.application?.ownerName
                      ? `Emails go to ${row.application.ownerName}, who owns the application.`
                      : "Emails go to everyone who works on the calendar until someone owns an application.")}
                </p>
                <ul className="grid gap-2">
                  {reminderSchedule(call.deadline).map((r) => {
                    const sent = sentFor(r.days);
                    const past = r.on <= today;
                    return (
                      <li key={r.days} className="flex flex-wrap justify-between gap-2 rounded-md border border-ve-line bg-white p-3">
                        <span>
                          {r.days} days before · {formatDate(r.on)}
                        </span>
                        <span className="text-sm text-ve-muted">
                          {sent ? `Sent to ${sent} ${sent === 1 ? "person" : "people"}` : past ? "Not sent" : "Not yet due"}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <p className="text-sm text-ve-muted">
                  Reminders go out at 8am India time. A call added late gets the nearest reminder straight away.
                </p>
              </>
            )}
          </section>

          {canEdit && !row.application && !call.skippedReason ? (
            <section aria-labelledby="skip-heading" className="grid content-start gap-3">
              <h2 id="skip-heading" className="text-xl font-bold">
                Not applying?
              </h2>
              <SkipForm id={call.id} />
            </section>
          ) : null}
        </div>
      </div>
    </>
  );
}

function Item({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="label text-xs text-ve-muted">{term}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}
