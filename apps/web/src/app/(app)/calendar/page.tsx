import { CALL_KIND_LABELS, CALL_KINDS, can, formatInrShort, REMINDER_DAYS, stageLabel } from "@ve/core";
import Link from "next/link";
import { Chip } from "@/components/chip";
import { EligibilityPill } from "@/components/eligibility-pill";
import { inputClass } from "@/components/field";
import { NoAccess } from "@/components/no-access";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/authz";
import { type CallRow, deadlineLabel, listCalls, monthGrid, monthLabel, shiftMonth } from "@/lib/calendar";
import { formatDate, todayInIndia } from "@/lib/format";

export const metadata = { title: "Awards calendar" };

type Search = { view?: string; month?: string; kind?: string; show?: string; skipped?: string; closed?: string };

const SHOW = [
  { value: "", label: "Eligible and needs check" },
  { value: "eligible", label: "Eligible only" },
  { value: "all", label: "Everything, including not eligible" },
] as const;

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const reminderDays = `${REMINDER_DAYS.slice(0, -1).join(", ")} and ${REMINDER_DAYS.at(-1)}`;

export default async function CalendarPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser();
  if (!can(user.roles, "calendar:view")) return <NoAccess what="the awards calendar" />;
  const canEdit = can(user.roles, "calendar:edit");
  const params = await searchParams;
  const today = todayInIndia();

  const view = params.view === "month" ? "month" : "list";
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(params.month ?? "") ? params.month! : today.slice(0, 7);
  const kind = CALL_KINDS.find((k) => k === params.kind) ?? "";
  const show = SHOW.find((s) => s.value === params.show)?.value ?? "";
  const withSkipped = params.skipped === "1";
  const withClosed = params.closed === "1";
  const filtered = Boolean(kind || show || withSkipped || withClosed);

  const all = await listCalls(today);
  const calls = all.filter(
    (c) =>
      (!kind || c.kind === kind) &&
      (show === "all" || (show === "eligible" ? c.eligibility === "eligible" : c.eligibility !== "not_eligible")) &&
      (withSkipped || !c.skippedReason),
  );

  const href = (next: Partial<{ view: string; month: string }>) => {
    const q = new URLSearchParams();
    const v = next.view ?? view;
    if (v === "month") {
      q.set("view", "month");
      if ((next.month ?? month) !== today.slice(0, 7)) q.set("month", next.month ?? month);
    }
    if (kind) q.set("kind", kind);
    if (show) q.set("show", show);
    if (withSkipped) q.set("skipped", "1");
    if (withClosed) q.set("closed", "1");
    const s = q.toString();
    return s ? `/calendar?${s}` : "/calendar";
  };

  const clearHref = view === "month" ? `/calendar?view=month${month === today.slice(0, 7) ? "" : `&month=${month}`}` : "/calendar";

  return (
    <>
      <PageHeader
        title="Awards and grants calendar"
        intro={`Award and grant calls VE could apply for, soonest deadline first. Reminders go out ${reminderDays} days before each deadline.`}
      />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <nav aria-label="Calendar view">
          <ul className="flex gap-2">
            <Chip href={href({ view: "list" })} active={view === "list"} label="List" />
            <Chip href={href({ view: "month" })} active={view === "month"} label="Month" />
          </ul>
        </nav>
        {canEdit ? (
          <Link href="/calendar/new" className="btn btn-primary no-underline">
            Add a call
          </Link>
        ) : null}
      </div>

      <form method="get" action="/calendar" aria-label="Filter calls" className="grid gap-3 rounded-lg border border-ve-line bg-white p-4 sm:grid-cols-2 lg:grid-cols-3">
        {view === "month" ? (
          <>
            <input type="hidden" name="view" value="month" />
            <input type="hidden" name="month" value={month} />
          </>
        ) : null}
        <div className="grid content-start gap-1">
          <label htmlFor="kind" className="font-medium">
            Kind
          </label>
          <select id="kind" name="kind" defaultValue={kind} className={inputClass}>
            <option value="">Awards, grants and calls for proposals</option>
            {CALL_KINDS.map((k) => (
              <option key={k} value={k}>
                {CALL_KIND_LABELS[k]}s only
              </option>
            ))}
          </select>
        </div>
        <div className="grid content-start gap-1">
          <label htmlFor="show" className="font-medium">
            Eligibility
          </label>
          <select id="show" name="show" defaultValue={show} className={inputClass}>
            {SHOW.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <fieldset className="grid content-start gap-1">
          <legend className="font-medium">Also show</legend>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="skipped" value="1" defaultChecked={withSkipped} className="accent-ve-olive" />
            Calls VE skipped
          </label>
          {view === "list" ? (
            <label className="flex items-center gap-2">
              <input type="checkbox" name="closed" value="1" defaultChecked={withClosed} className="accent-ve-olive" />
              Closed calls
            </label>
          ) : null}
        </fieldset>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-3">
          <button type="submit" className="btn btn-primary">
            Show calls
          </button>
          {filtered ? (
            <Link href={clearHref} className="btn btn-secondary no-underline">
              Clear filters
            </Link>
          ) : null}
        </div>
      </form>

      {all.length === 0 ? (
        <section className="grid max-w-prose gap-2 rounded-lg border border-dashed border-ve-line bg-white p-6">
          <h2 className="text-lg font-bold">No calls yet</h2>
          <p className="text-ve-muted">
            {canEdit ? "Add an award or grant call with its deadline, and reminders will start." : "Calls appear here once someone at VE adds them."}
          </p>
        </section>
      ) : view === "list" ? (
        <ListView calls={calls} withClosed={withClosed} />
      ) : (
        <MonthView calls={calls} month={month} today={today} href={href} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

function ListView({ calls, withClosed }: { calls: CallRow[]; withClosed: boolean }) {
  const open = calls.filter((c) => c.status === "open");
  const later = calls.filter((c) => c.status === "upcoming");
  const unannounced = calls.filter((c) => c.status === "not_announced");
  const closed = calls.filter((c) => c.status === "closed").reverse();
  return (
    <>
      <CallTable id="open" title="Open now" empty="No open calls match." rows={open} />
      {later.length ? <CallTable id="later" title="Opening later" rows={later} showOpens /> : null}
      {unannounced.length ? (
        <section aria-labelledby="unannounced-heading" className="grid gap-3">
          <div>
            <h2 id="unannounced-heading" className="text-xl font-bold">
              Dates not announced <span className="text-base font-normal text-ve-muted">({unannounced.length})</span>
            </h2>
            <p className="text-sm text-ve-muted">Awards that come round each year. Add the dates once the organiser publishes them.</p>
          </div>
          <ul className="grid gap-2 sm:grid-cols-2">
            {unannounced.map((c) => (
              <li key={c.id} className="grid gap-1 rounded-md border border-ve-line bg-white p-3">
                <p>
                  <Link href={`/calendar/${c.id}`} className="font-medium">
                    {c.title}
                  </Link>
                </p>
                <p className="text-sm text-ve-muted">
                  {CALL_KIND_LABELS[c.kind]} · {c.funder.name}
                </p>
                {c.usualWindow ? <p className="text-sm">{c.usualWindow}</p> : null}
                <p>
                  <EligibilityPill verdict={c.eligibility} />
                  {c.skippedReason ? <span className="ml-2 text-sm text-ve-muted">Skipped</span> : null}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {withClosed ? <CallTable id="closed" title="Closed" empty="No closed calls match." rows={closed} /> : null}
    </>
  );
}

function CallTable({ id, title, empty, rows, showOpens }: { id: string; title: string; empty?: string; rows: CallRow[]; showOpens?: boolean }) {
  return (
    <section aria-labelledby={`${id}-heading`} className="grid gap-3">
      <h2 id={`${id}-heading`} className="text-xl font-bold">
        {title} <span className="text-base font-normal text-ve-muted">({rows.length})</span>
      </h2>
      {rows.length ? (
        <div className="relative overflow-x-auto rounded-lg border border-ve-line bg-white">
          <table className="w-full min-w-[48rem] text-left text-sm">
            <thead>
              <tr className="border-b border-ve-line bg-ve-cream">
                <th scope="col" className="label px-3 py-2 text-xs text-ve-muted">
                  {showOpens ? "Opens" : "Deadline"}
                </th>
                <th scope="col" className="label px-3 py-2 text-xs text-ve-muted">Call</th>
                <th scope="col" className="label px-3 py-2 text-xs text-ve-muted">Eligibility</th>
                <th scope="col" className="label px-3 py-2 text-right text-xs text-ve-muted">Prize or grant</th>
                <th scope="col" className="label px-3 py-2 text-xs text-ve-muted">Application</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-t border-ve-line align-top">
                  <td className="whitespace-nowrap px-3 py-3">
                    {showOpens ? (
                      <>
                        {formatDate(c.opensOn)}
                        {c.deadline ? <span className="block text-xs text-ve-muted">Deadline {formatDate(c.deadline)}</span> : null}
                      </>
                    ) : (
                      <>
                        {c.deadline ? formatDate(c.deadline) : "Not set"}
                        <span className={`block text-xs ${c.daysLeft !== null && c.daysLeft >= 0 && c.daysLeft <= 7 ? "font-medium text-bad" : "text-ve-muted"}`}>
                          {deadlineLabel(c.daysLeft)}
                        </span>
                      </>
                    )}
                  </td>
                  <th scope="row" className="px-3 py-3 font-normal">
                    <Link href={`/calendar/${c.id}`} className="font-medium">
                      {c.title}
                    </Link>
                    <span className="block text-xs text-ve-muted">
                      {CALL_KIND_LABELS[c.kind]} · {c.funder.name}
                    </span>
                  </th>
                  <td className="px-3 py-3">
                    <EligibilityPill verdict={c.eligibility} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right">{formatInrShort(c.amount) || c.amountNote || "–"}</td>
                  <td className="px-3 py-3">
                    <ApplicationCell call={c} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-ve-muted">{empty}</p>
      )}
    </section>
  );
}

function ApplicationCell({ call }: { call: CallRow }) {
  if (call.application) {
    return (
      <>
        <Link href={`/pursuits/${call.application.id}`}>{stageLabel(call.application.stage)}</Link>
        <span className="block text-xs text-ve-muted">{call.application.ownerName ?? "No owner yet"}</span>
      </>
    );
  }
  if (call.skippedReason) {
    return (
      <>
        Skipped
        <span className="block text-xs text-ve-muted">{call.skippedReason}</span>
      </>
    );
  }
  return <span className="text-ve-muted">Not started</span>;
}

// ---------------------------------------------------------------------------

type Event = { call: CallRow; what: "deadline" | "opens" };

function MonthView({ calls, month, today, href }: { calls: CallRow[]; month: string; today: string; href: (n: { month: string }) => string }) {
  const events = new Map<string, Event[]>();
  const add = (day: string | null, e: Event) => {
    if (day?.startsWith(month)) events.set(day, [...(events.get(day) ?? []), e]);
  };
  for (const c of calls) {
    add(c.opensOn, { call: c, what: "opens" });
    add(c.deadline, { call: c, what: "deadline" });
  }
  const days = [...events.keys()].sort();
  const label = monthLabel(month);

  return (
    <section aria-labelledby="month-heading" className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="month-heading" className="text-xl font-bold">
          {label}
        </h2>
        <nav aria-label="Months">
          <ul className="flex flex-wrap gap-2">
            <li>
              <Link href={href({ month: shiftMonth(month, -1) })} className="btn btn-secondary no-underline">
                <span aria-hidden="true">← </span>
                {monthLabel(shiftMonth(month, -1))}
              </Link>
            </li>
            {month !== today.slice(0, 7) ? (
              <li>
                <Link href={href({ month: today.slice(0, 7) })} className="btn btn-secondary no-underline">
                  This month
                </Link>
              </li>
            ) : null}
            <li>
              <Link href={href({ month: shiftMonth(month, 1) })} className="btn btn-secondary no-underline">
                {monthLabel(shiftMonth(month, 1))}
                <span aria-hidden="true"> →</span>
              </Link>
            </li>
          </ul>
        </nav>
      </div>

      <div className="relative overflow-x-auto rounded-lg border border-ve-line bg-white">
        <table className="w-full min-w-[56rem] table-fixed border-collapse text-sm">
          <caption className="sr-only">Deadlines and opening dates in {label}. The same dates are listed after the grid.</caption>
          <thead>
            <tr className="bg-ve-cream">
              {WEEKDAYS.map((d) => (
                <th key={d} scope="col" className="label px-2 py-2 text-left text-xs text-ve-muted">
                  <span aria-hidden="true">{d.slice(0, 3)}</span>
                  <span className="sr-only">{d}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {monthGrid(month).map((week, i) => (
              <tr key={i}>
                {week.map((day, j) =>
                  day ? (
                    <td
                      key={day}
                      aria-current={day === today ? "date" : undefined}
                      className={`h-24 border border-ve-line p-1.5 align-top ${day === today ? "bg-ve-yellow-soft" : ""}`}
                    >
                      <p className={`text-xs ${day === today ? "font-bold text-ve-charcoal" : "text-ve-muted"}`}>
                        {Number(day.slice(8))}
                        {day === today ? <span className="sr-only"> (today)</span> : null}
                      </p>
                      <ul className="grid gap-1">
                        {(events.get(day) ?? []).map((e) => (
                          <li key={`${e.call.id}-${e.what}`} className="leading-tight">
                            <span className={`label mr-1 text-[0.65rem] ${e.what === "deadline" ? "text-bad" : "text-ok"}`}>
                              {e.what === "deadline" ? "Due" : "Opens"}
                            </span>
                            <Link href={`/calendar/${e.call.id}`} className="text-xs">
                              {e.call.title}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </td>
                  ) : (
                    <td key={`empty-${j}`} className="border border-ve-line bg-ve-paper" />
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section aria-labelledby="agenda-heading" className="grid gap-2">
        <h3 id="agenda-heading" className="text-lg font-bold">
          Everything in {label}
        </h3>
        {days.length ? (
          <ul className="grid gap-2">
            {days.flatMap((day) =>
              events.get(day)!.map((e) => (
                <li key={`${day}-${e.call.id}-${e.what}`} className="rounded-md border border-ve-line bg-white p-3">
                  <p>
                    <strong>{formatDate(day)}</strong>: {e.what === "deadline" ? "Deadline for " : "Opens: "}
                    <Link href={`/calendar/${e.call.id}`}>{e.call.title}</Link>
                  </p>
                  <p className="text-sm text-ve-muted">
                    {CALL_KIND_LABELS[e.call.kind]} · {e.call.funder.name}
                  </p>
                </li>
              )),
            )}
          </ul>
        ) : (
          <p className="text-ve-muted">No deadlines or opening dates this month.</p>
        )}
      </section>
    </section>
  );
}
