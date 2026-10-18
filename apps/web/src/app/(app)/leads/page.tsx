import {
  CAUSE_WORDS,
  can,
  DISABILITY_WORDS,
  formatInrShort,
  fyLabel,
  INDIAN_STATES,
  PAN_INDIA,
} from "@ve/core";
import { csrBreakdown, db, funders, getFitSettings } from "@ve/db";
import { and, asc, eq, exists, gte, ilike, inArray, or, type SQL, sql } from "drizzle-orm";
import Link from "next/link";
import { EligibilityPill, FitBadge } from "@/components/eligibility-pill";
import { inputClass } from "@/components/field";
import { NoAccess } from "@/components/no-access";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/authz";

export const metadata = { title: "CSR leads" };

const PAGE_SIZE = 50;

type Search = { q?: string; show?: string; state?: string; cause?: string; ticket?: string; new?: string; page?: string };

const SHOW = [
  { value: "", label: "Eligible and needs check" },
  { value: "eligible", label: "Eligible only" },
  { value: "all", label: "Everything, including not eligible" },
] as const;
const CAUSES = [
  { value: "", label: "Any cause" },
  { value: "education", label: "Education and skills" },
  { value: "disability", label: "Disability" },
] as const;
const TICKETS = [0, 500_000, 1_000_000, 2_500_000, 5_000_000];

const wordsPattern = (words: string[]) => words.map((w) => w.replace(/[^a-z ]/g, "")).join("|");

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser();
  if (!can(user.roles, "leads:view")) return <NoAccess what="CSR leads" />;
  const canImport = can(user.roles, "leads:edit");
  const params = await searchParams;
  const settings = await getFitSettings();

  const show = SHOW.find((s) => s.value === params.show)?.value ?? "";
  const cause = CAUSES.find((c) => c.value === params.cause)?.value ?? "";
  const state = [PAN_INDIA, ...INDIAN_STATES].find((s) => s === params.state) ?? "";
  const ticket = TICKETS.find((t) => String(t) === params.ticket) ?? 0;
  const onlyNew = params.new === "1";
  const q = (params.q ?? "").trim().slice(0, 100);
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const where: SQL[] = [eq(funders.type, "company")];
  if (show === "eligible") where.push(eq(funders.eligibility, "eligible"));
  else if (show === "") where.push(inArray(funders.eligibility, ["eligible", "needs_check"]));
  if (q) where.push(or(ilike(funders.name, `%${q}%`), ilike(funders.cin, `%${q}%`))!);
  if (onlyNew) where.push(gte(funders.createdAt, sql`now() - interval '7 days'`));
  if (ticket) where.push(gte(funders.ticketEstimate, ticket));
  const breakdown = (kind: "sector" | "state", match: SQL) =>
    exists(
      db
        .select({ one: sql`1` })
        .from(csrBreakdown)
        .where(and(eq(csrBreakdown.funderId, funders.id), eq(csrBreakdown.kind, kind), match)),
    );
  if (state) where.push(breakdown("state", eq(csrBreakdown.name, state)));
  if (cause) {
    const words = cause === "disability" ? DISABILITY_WORDS : CAUSE_WORDS;
    where.push(breakdown("sector", sql`${csrBreakdown.name} ~* ${wordsPattern(words)}`));
  }

  const [rows, [counted], [companies]] = await Promise.all([
    db
      .select()
      .from(funders)
      .where(and(...where))
      .orderBy(sql`${funders.fitScore} desc nulls last`, asc(funders.name))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ n: sql<number>`count(*)::int` }).from(funders).where(and(...where)),
    db.select({ n: sql<number>`count(*)::int` }).from(funders).where(eq(funders.type, "company")),
  ]);
  const total = counted?.n ?? 0;
  const any = (companies?.n ?? 0) > 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Boolean(q || show || cause || state || ticket || onlyNew);

  const pageHref = (p: number) => {
    const s = new URLSearchParams(Object.entries({ ...params, page: String(p) }).filter(([, v]) => v) as [string, string][]);
    return `/leads?${s}`;
  };

  return (
    <>
      <PageHeader
        title="CSR leads"
        intro="Indian companies ranked by how well they fit VE, from National CSR Portal data, peer NGO donor lists and what VE has added. Open a company to see why it scored what it did."
      />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-ve-muted">
          <strong className="text-ve-charcoal">{total}</strong> {total === 1 ? "company" : "companies"}
          {filtered ? " match" : ""} · floor {formatInrShort(settings.floorRupees)}
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/leads/donors" className="btn btn-secondary no-underline">
            {canImport ? "Add peer NGO donors" : "Peer NGO donors"}
          </Link>
          <Link href="/leads/import" className={`btn no-underline ${canImport ? "btn-primary" : "btn-secondary"}`}>
            {canImport ? "Import CSR data" : "See imports"}
          </Link>
        </div>
      </div>

      <form method="get" action="/leads" aria-label="Filter leads" className="grid gap-3 rounded-lg border border-ve-line bg-white p-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="grid content-start gap-1">
          <label htmlFor="q" className="font-medium">
            Company or CIN
          </label>
          <input id="q" name="q" type="search" defaultValue={q} className={inputClass} />
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
        <div className="grid content-start gap-1">
          <label htmlFor="state" className="font-medium">
            Spends in
          </label>
          <select id="state" name="state" defaultValue={state} className={inputClass}>
            <option value="">Any state</option>
            <optgroup label="VE states">
              {settings.veStates.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </optgroup>
            <optgroup label="Everywhere else">
              {[PAN_INDIA, ...INDIAN_STATES.filter((s) => !settings.veStates.includes(s))].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </optgroup>
          </select>
        </div>
        <div className="grid content-start gap-1">
          <label htmlFor="cause" className="font-medium">
            Cause
          </label>
          <select id="cause" name="cause" defaultValue={cause} className={inputClass}>
            {CAUSES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="grid content-start gap-1">
          <label htmlFor="ticket" className="font-medium">
            Likely grant
          </label>
          <select id="ticket" name="ticket" defaultValue={ticket ? String(ticket) : ""} className={inputClass}>
            {TICKETS.map((t) => (
              <option key={t} value={t ? String(t) : ""}>
                {t ? `${formatInrShort(t)} or more` : "Any amount"}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex items-center gap-2 py-2">
            <input type="checkbox" name="new" value="1" defaultChecked={onlyNew} />
            New in the last 7 days
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-3">
          <button type="submit" className="btn btn-primary">
            Show leads
          </button>
          {filtered ? (
            <Link href="/leads" className="btn btn-secondary no-underline">
              Clear filters
            </Link>
          ) : null}
        </div>
      </form>

      {rows.length === 0 ? (
        <section className="grid max-w-prose gap-2 rounded-lg border border-dashed border-ve-line bg-white p-6">
          <h2 className="text-lg font-bold">{any ? "No companies match" : "No CSR data yet"}</h2>
          <p className="text-ve-muted">
            {any
              ? "Try fewer filters, or include companies that aren't eligible."
              : canImport
                ? "Import a CSV from the National CSR Portal to build the list."
                : "Someone with the Associate role needs to import National CSR Portal data first."}
          </p>
        </section>
      ) : (
        <div className="relative overflow-x-auto rounded-lg border border-ve-line bg-white" role="region" aria-label="Ranked leads" tabIndex={0}>
          <table className="w-full min-w-[60rem] text-left text-sm">
            <caption className="sr-only">
              Companies ranked by fit score, highest first. Page {page} of {pages}.
            </caption>
            <thead className="bg-ve-cream">
              <tr>
                <th scope="col" className="label px-3 py-2 text-xs text-ve-muted">Fit</th>
                <th scope="col" className="label px-3 py-2 text-xs text-ve-muted">Company (Indian entity)</th>
                <th scope="col" className="label px-3 py-2 text-xs text-ve-muted">Eligibility</th>
                <th scope="col" className="label px-3 py-2 text-right text-xs text-ve-muted">Last CSR spend</th>
                <th scope="col" className="label px-3 py-2 text-right text-xs text-ve-muted">Likely grant</th>
                <th scope="col" className="label px-3 py-2 text-xs text-ve-muted">Why it fits</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => (
                <tr key={f.id} className="border-t border-ve-line align-top">
                  <td className="px-3 py-3">
                    <FitBadge score={f.fitScore} />
                  </td>
                  <th scope="row" className="px-3 py-3 font-medium">
                    <Link href={`/funders/${f.id}`}>{f.name}</Link>
                    <span className="block text-xs font-normal text-ve-muted">{f.cin ? `CIN ${f.cin}` : "No CIN found"}</span>
                  </th>
                  <td className="px-3 py-3">
                    <EligibilityPill verdict={f.eligibility} />
                  </td>
                  <td className="px-3 py-3 text-right whitespace-nowrap">
                    {f.latestSpend !== null ? formatInrShort(f.latestSpend) || "₹0" : <span className="text-ve-muted">None</span>}
                    {f.latestFy ? <span className="block text-xs text-ve-muted">{fyLabel(f.latestFy)}</span> : null}
                  </td>
                  <td className="px-3 py-3 text-right whitespace-nowrap">
                    {f.ticketEstimate !== null ? formatInrShort(f.ticketEstimate) : <span className="text-ve-muted">Unknown</span>}
                  </td>
                  <td className="max-w-md px-3 py-3">{f.fitSummary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 ? (
        <nav aria-label="Pages of leads" className="flex flex-wrap items-center gap-3">
          {page > 1 ? <Link href={pageHref(page - 1)}>Previous page</Link> : null}
          <span className="text-ve-muted">
            Page {page} of {pages}
          </span>
          {page < pages ? <Link href={pageHref(page + 1)}>Next page</Link> : null}
        </nav>
      ) : null}
    </>
  );
}
