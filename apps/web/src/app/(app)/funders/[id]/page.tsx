import {
  can,
  cinIsListed,
  cinState,
  FIT_PART_LABELS,
  FUNDER_TYPE_LABELS,
  formatInrShort,
  fyLabel,
  sortFysDesc,
  stageLabel,
} from "@ve/core";
import { companyReports, csrBreakdown, csrYears, db, funderGrantees, funders, pursuits } from "@ve/db";
import { followedCompanies, readerConfigured } from "@ve/ingest";
import { asc, desc, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EligibilityPill, FitBadge } from "@/components/eligibility-pill";
import { NoAccess } from "@/components/no-access";
import { requireUser } from "@/lib/authz";
import { formatDate } from "@/lib/format";
import { deleteGrantee } from "../actions";
import { AnnualReportSection } from "./annual-report";
import { GranteeForm, NotesForm } from "./forms";

type Params = { id: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function load(id: string) {
  if (!UUID.test(id)) return null;
  return db.query.funders.findFirst({
    where: eq(funders.id, id),
    with: {
      csrYears: { orderBy: desc(csrYears.fy), with: { dataImport: { columns: { source: true, fileName: true, createdAt: true } } } },
      csrBreakdown: { orderBy: desc(csrBreakdown.amount) },
      grantees: { orderBy: [desc(funderGrantees.fy), asc(funderGrantees.name)] },
      pursuits: { orderBy: desc(pursuits.updatedAt), columns: { id: true, title: true, stage: true } },
      // Newest year first; a report not read yet, with no year, comes after the read ones.
      companyReports: { orderBy: [sql`${companyReports.fy} desc nulls last`, desc(companyReports.foundAt)] },
    },
  });
}

export async function generateMetadata({ params }: { params: Promise<Params> }) {
  const f = await load((await params).id);
  return { title: f ? f.name : "Funder not found" };
}

export default async function FunderPage({ params }: { params: Promise<Params> }) {
  const user = await requireUser();
  if (!can(user.roles, "leads:view")) return <NoAccess what="CSR leads" />;
  const canEdit = can(user.roles, "leads:edit");
  const canPursue = can(user.roles, "pipeline:edit");
  const f = await load((await params).id);
  if (!f) notFound();

  const latest = sortFysDesc(f.csrYears.map((y) => y.fy))[0];
  const latestYear = f.csrYears.find((y) => y.fy === latest);
  const split = (kind: "sector" | "state") => f.csrBreakdown.filter((b) => b.fy === latest && b.kind === kind).slice(0, 8);
  const state = cinState(f.cin);
  const followed = f.type === "company" ? await followedCompanies() : [];
  const addedByReport = new Map<string, number>();
  for (const g of f.grantees) if (g.companyReportId) addedByReport.set(g.companyReportId, (addedByReport.get(g.companyReportId) ?? 0) + 1);

  return (
    <>
      <p>
        <Link href="/leads">
          <span aria-hidden="true">← </span>CSR leads
        </Link>
      </p>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-1">
          <h1 className="text-3xl font-bold text-ve-charcoal">{f.name}</h1>
          <p className="text-ve-muted">
            {FUNDER_TYPE_LABELS[f.type]}
            {f.cin ? ` · CIN ${f.cin}` : " · No CIN found"}
            {state ? ` · Registered in ${state}` : ""}
            {cinIsListed(f.cin) ? " · Listed" : ""}
          </p>
        </div>
        {canPursue ? (
          <Link href={`/pursuits/new?funderId=${f.id}`} className="btn btn-primary no-underline">
            Start a pursuit
          </Link>
        ) : null}
      </header>

      {f.pursuits.length ? (
        <section aria-labelledby="pursuits-heading" className="grid gap-2 rounded-lg border border-ve-line bg-white p-4">
          <h2 id="pursuits-heading" className="font-bold">
            In the pipeline
          </h2>
          <ul className="grid gap-1">
            {f.pursuits.map((p) => (
              <li key={p.id}>
                <Link href={`/pursuits/${p.id}`}>{p.title}</Link> <span className="text-ve-muted">· {stageLabel(p.stage)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
        <section aria-labelledby="eligibility-heading" className="grid content-start gap-3 rounded-lg border border-ve-line bg-white p-5">
          <h2 id="eligibility-heading" className="text-xl font-bold">
            Eligibility
          </h2>
          <p>
            <EligibilityPill verdict={f.eligibility} />
          </p>
          <ul className="grid gap-1">
            {(f.eligibilityReasons ?? []).map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <p className="text-sm text-ve-muted">Checked by tested rules: an Indian entity with a CIN, CSR reported in the last two years, and above VE's floor.</p>
        </section>

        <section aria-labelledby="fit-heading" className="grid content-start gap-3 rounded-lg border border-ve-line bg-white p-5">
          <div className="flex items-center gap-4">
            <FitBadge score={f.fitScore} size="lg" />
            <div>
              <h2 id="fit-heading" className="text-xl font-bold">
                Fit score
              </h2>
              <p>{f.fitSummary ?? "Not scored yet."}</p>
            </div>
          </div>
          {f.fitParts?.length ? (
            <table className="w-full text-left text-sm">
              <caption className="sr-only">How the fit score adds up</caption>
              <thead>
                <tr className="border-b border-ve-line">
                  <th scope="col" className="label py-2 pr-3 text-xs text-ve-muted">Part</th>
                  <th scope="col" className="label py-2 pr-3 text-right text-xs text-ve-muted">Points</th>
                  <th scope="col" className="label py-2 text-xs text-ve-muted">Why</th>
                </tr>
              </thead>
              <tbody>
                {f.fitParts.map((p) => (
                  <tr key={p.part} className="border-t border-ve-line align-top">
                    <th scope="row" className="py-2 pr-3 font-medium">
                      {FIT_PART_LABELS[p.part].name}
                      <span className="block text-xs font-normal text-ve-muted">{FIT_PART_LABELS[p.part].description}</span>
                    </th>
                    <td className="py-2 pr-3 text-right whitespace-nowrap">
                      {p.points}
                      <span className="text-ve-muted"> of {p.weight}</span>
                    </td>
                    <td className="py-2">{p.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {f.ticketBasis ? (
            <p className="text-sm text-ve-muted">
              Likely grant: {f.ticketEstimate !== null ? formatInrShort(f.ticketEstimate) : "unknown"}. {f.ticketBasis}.
            </p>
          ) : null}
        </section>
      </div>

      <section aria-labelledby="spend-heading" className="grid gap-3">
        <h2 id="spend-heading" className="text-xl font-bold">
          CSR spend by year
        </h2>
        {f.csrYears.length ? (
          <div className="relative overflow-x-auto rounded-lg border border-ve-line bg-white">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <caption className="sr-only">CSR spend by financial year, newest first</caption>
              <thead className="bg-ve-cream">
                <tr>
                  <th scope="col" className="label px-3 py-2 text-xs text-ve-muted">Year</th>
                  <th scope="col" className="label px-3 py-2 text-right text-xs text-ve-muted">Obligation</th>
                  <th scope="col" className="label px-3 py-2 text-right text-xs text-ve-muted">Spent</th>
                  <th scope="col" className="label px-3 py-2 text-right text-xs text-ve-muted">Projects</th>
                  <th scope="col" className="label px-3 py-2 text-xs text-ve-muted">Source</th>
                </tr>
              </thead>
              <tbody>
                {f.csrYears.map((y) => (
                  <tr key={y.id} className="border-t border-ve-line">
                    <th scope="row" className="px-3 py-2 font-medium">{fyLabel(y.fy)}</th>
                    <td className="px-3 py-2 text-right">{y.prescribed !== null ? formatInrShort(y.prescribed) : <span className="text-ve-muted">Not given</span>}</td>
                    <td className="px-3 py-2 text-right">{formatInrShort(y.spent) || "₹0"}</td>
                    <td className="px-3 py-2 text-right">{y.projectCount}</td>
                    <td className="px-3 py-2 text-ve-muted">
                      {y.dataImport ? `${y.dataImport.source}, ${y.dataImport.fileName}, imported ${formatDate(y.dataImport.createdAt)}` : "Unknown"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-ve-muted">No CSR data for this company yet.</p>
        )}
        {latestYear ? (
          <div className="grid gap-6 md:grid-cols-2">
            {(["sector", "state"] as const).map((kind) => {
              const rows = split(kind);
              return (
                <div key={kind} className="grid content-start gap-2">
                  <h3 className="font-bold">
                    {kind === "sector" ? "By development sector" : "By state"}, {fyLabel(latestYear.fy)}
                  </h3>
                  {rows.length ? (
                    <ul className="grid gap-1">
                      {rows.map((b) => (
                        <li key={b.id} className="flex justify-between gap-3 border-b border-ve-line py-1">
                          <span>{b.name}</span>
                          <span className="whitespace-nowrap">
                            {formatInrShort(b.amount)}
                            <span className="text-ve-muted"> · {latestYear.spent ? Math.round((b.amount / latestYear.spent) * 100) : 0}%</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-ve-muted">Not in the data.</p>
                  )}
                </div>
              );
            })}
          </div>
        ) : null}
      </section>

      {f.type === "company" ? (
        <AnnualReportSection
          funder={f}
          reports={f.companyReports}
          addedByReport={addedByReport}
          followed={followed.some((c) => c.id === f.id)}
          followedCount={followed.length}
          readerReady={readerConfigured()}
          canEdit={canEdit}
        />
      ) : null}

      <div className="grid gap-8 lg:grid-cols-2">
        <section aria-labelledby="grantees-heading" className="grid content-start gap-3">
          <h2 id="grantees-heading" className="text-xl font-bold">
            NGOs it funds
          </h2>
          <p className="text-sm text-ve-muted">
            From annual report CSR annexures or what VE knows. Peer NGOs on this list raise the fit score. Settings holds the peer list.
          </p>
          {f.grantees.length ? (
            <ul className="grid gap-2">
              {f.grantees.map((g) => (
                <li key={g.id} className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-ve-line bg-white p-3">
                  <div>
                    <p className="font-medium">{g.name}</p>
                    <p className="text-sm text-ve-muted">
                      {[g.fy ? fyLabel(g.fy) : null, g.amount ? formatInrShort(g.amount) : null].filter(Boolean).join(" · ")}
                      {g.sourceUrl ? (
                        <>
                          {g.fy || g.amount ? " · " : ""}
                          <a href={g.sourceUrl} target="_blank" rel="noreferrer">
                            {g.sourceLabel ?? "Source"}
                            <span className="sr-only"> (opens in a new tab)</span>
                          </a>
                        </>
                      ) : g.sourceLabel ? (
                        `${g.fy || g.amount ? " · " : ""}${g.sourceLabel}`
                      ) : null}
                    </p>
                  </div>
                  {canEdit ? (
                    <form action={deleteGrantee}>
                      <input type="hidden" name="id" value={g.id} />
                      <input type="hidden" name="funderId" value={f.id} />
                      <button type="submit" className="btn btn-secondary px-3 py-1 text-xs" aria-label={`Remove ${g.name}`}>
                        Remove
                      </button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-ve-muted">None recorded yet.</p>
          )}
          {canEdit ? (
            <div className="rounded-lg border border-ve-line bg-white p-4">
              <h3 className="mb-3 font-bold">Add an NGO it funds</h3>
              <GranteeForm funderId={f.id} />
            </div>
          ) : null}
        </section>

        <section aria-labelledby="notes-heading" className="grid content-start gap-3">
          <h2 id="notes-heading" className="text-xl font-bold">
            What VE knows
          </h2>
          {canEdit ? (
            <div className="rounded-lg border border-ve-line bg-white p-4">
              <NotesForm id={f.id} warmPath={f.warmPath} isForeign={f.isForeign} />
            </div>
          ) : (
            <dl className="grid gap-2">
              <div>
                <dt className="label text-xs text-ve-muted">Warm path</dt>
                <dd>{f.warmPath ?? "None recorded"}</dd>
              </div>
              {f.isForeign ? (
                <div>
                  <dt className="label text-xs text-ve-muted">Foreign entity</dt>
                  <dd>Yes. VE can't accept its money without FCRA.</dd>
                </div>
              ) : null}
            </dl>
          )}
          {f.scoredAt ? <p className="text-sm text-ve-muted">Scored {formatDate(f.scoredAt)}.</p> : null}
        </section>
      </div>
    </>
  );
}
