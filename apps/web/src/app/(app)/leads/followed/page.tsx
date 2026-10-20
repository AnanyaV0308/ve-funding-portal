import { can, cinIsListed, currentFy, dueReportFy, fyLabel } from "@ve/core";
import { companyReports, csrPlans, db, getCompaniesFollowed } from "@ve/db";
import { followedCompanies, readerConfigured } from "@ve/ingest";
import { desc, inArray, sql } from "drizzle-orm";
import Link from "next/link";
import { FitBadge } from "@/components/eligibility-pill";
import { NoAccess } from "@/components/no-access";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/authz";
import { formatDate } from "@/lib/format";
import { companyReportStatus } from "../../funders/[id]/annual-report";
import { csrPlanStatus } from "../../funders/[id]/csr-plan";
import { FollowForm } from "./follow-form";

export const metadata = { title: "Companies followed" };

/** When the portal last looked on a company's website, and what it found. */
function Looked({ requestedAt, checkedAt, result }: { requestedAt: Date | null; checkedAt: Date | null; result: string | null }) {
  return (
    <span className="block text-ve-muted">
      {requestedAt ? "Looking in the next few minutes" : checkedAt ? `Looked ${formatDate(checkedAt)}: ${result ?? ""}` : (result ?? "Not looked for yet")}
    </span>
  );
}

export default async function FollowedCompaniesPage() {
  const user = await requireUser();
  if (!can(user.roles, "leads:view")) return <NoAccess what="CSR leads" />;
  const isAdmin = can(user.roles, "settings:manage");

  const [followed, count] = await Promise.all([followedCompanies(), getCompaniesFollowed()]);
  const ids = followed.map((f) => f.id);
  const [reports, plans] = ids.length
    ? await Promise.all([
        db
          .select()
          .from(companyReports)
          .where(inArray(companyReports.funderId, ids))
          .orderBy(sql`${companyReports.fy} desc nulls last`, desc(companyReports.foundAt)),
        db
          .select()
          .from(csrPlans)
          .where(inArray(csrPlans.funderId, ids))
          .orderBy(sql`${csrPlans.fy} desc nulls last`, desc(csrPlans.foundAt)),
      ])
    : [[], []];
  const readerReady = readerConfigured();
  const today = new Date();
  const due = dueReportFy(today);
  const year = currentFy(today);
  const listed = followed.filter((f) => cinIsListed(f.cin));
  const withReport = listed.filter((f) => reports.some((r) => r.funderId === f.id && r.status === "read" && r.fy && r.fy >= due)).length;
  const withPlan = followed.filter((f) => plans.some((p) => p.funderId === f.id && p.status === "read" && p.fy && p.fy >= year)).length;

  return (
    <>
      <p>
        <Link href="/leads">
          <span aria-hidden="true">← </span>CSR leads
        </Link>
      </p>
      <PageHeader
        title="Companies followed"
        intro="The portal follows the companies that fit VE best on their own websites. Each year it finds a company's CSR action plan, which says what it is funding that year, and a listed company's annual report, which says what it spent and often which NGOs ran its projects, a year or more before the National CSR Portal does. It reads what it finds and scores the company again. It never fetches from NSE or BSE, whose terms don't allow it."
      />

      {!readerReady ? (
        <p className="rounded-md bg-warn-soft p-3 text-warn">
          Looking for and reading plans and reports needs an Anthropic API key, which isn&apos;t set up yet. Until then, nothing here changes on its own.
        </p>
      ) : null}

      <section aria-labelledby="followed-heading" className="grid gap-3">
        <h2 id="followed-heading" className="text-xl font-bold">
          Companies
        </h2>
        <p className="text-ve-muted">
          {followed.length
            ? `${followed.length} ${followed.length === 1 ? "company" : "companies"}, best fit first. ${withPlan} have their ${fyLabel(year)} CSR action plan read, and ${withReport} of the ${listed.length} listed ones their ${fyLabel(due)} annual report.`
            : "No companies to follow yet. Companies come from National CSR Portal imports."}
        </p>
        {followed.length ? (
          <div className="relative overflow-x-auto rounded-lg border border-ve-line bg-white">
            <table className="w-full min-w-[48rem] text-left text-sm">
              <caption className="sr-only">Companies the portal follows, best fit first</caption>
              <thead className="bg-ve-cream">
                <tr>
                  <th scope="col" className="label px-3 py-2 text-xs text-ve-muted">
                    Fit
                  </th>
                  <th scope="col" className="label px-3 py-2 text-xs text-ve-muted">
                    Company
                  </th>
                  <th scope="col" className="label px-3 py-2 text-xs text-ve-muted">
                    CSR action plan
                  </th>
                  <th scope="col" className="label px-3 py-2 text-xs text-ve-muted">
                    Annual report
                  </th>
                </tr>
              </thead>
              <tbody>
                {followed.map((f) => {
                  const p = plans.find((x) => x.funderId === f.id);
                  const r = reports.find((x) => x.funderId === f.id);
                  return (
                    <tr key={f.id} className="border-t border-ve-line align-top">
                      <td className="px-3 py-2">
                        <FitBadge score={f.fitScore} />
                      </td>
                      <th scope="row" className="px-3 py-2 font-medium">
                        <Link href={`/funders/${f.id}`}>{f.name}</Link>
                      </th>
                      <td className="px-3 py-2">
                        {p ? (
                          <>
                            {p.fy ? fyLabel(p.fy) : p.title}
                            <span className="block text-ve-muted">{csrPlanStatus(p, readerReady)}</span>
                          </>
                        ) : (
                          "None yet"
                        )}
                        <Looked requestedAt={f.planCheckRequestedAt} checkedAt={f.planCheckedAt} result={f.planCheckResult} />
                      </td>
                      <td className="px-3 py-2">
                        {r ? (
                          <>
                            {r.fy ? fyLabel(r.fy) : r.title}
                            <span className="block text-ve-muted">{companyReportStatus(r, readerReady)}</span>
                          </>
                        ) : cinIsListed(f.cin) ? (
                          "None yet"
                        ) : (
                          <span className="text-ve-muted">Unlisted, so the portal doesn&apos;t look for it</span>
                        )}
                        {cinIsListed(f.cin) || f.reportCheckedAt ? (
                          <Looked requestedAt={f.reportCheckRequestedAt} checkedAt={f.reportCheckedAt} result={f.reportCheckResult} />
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {isAdmin ? (
        <section aria-labelledby="follow-heading" className="grid gap-3 rounded-lg border border-ve-line bg-white p-5">
          <h2 id="follow-heading" className="text-xl font-bold">
            How many companies to follow
          </h2>
          <FollowForm count={count} />
        </section>
      ) : null}

      <p className="text-sm text-ve-muted">
        Any company&apos;s page can also look for its plan or report, or take a link or an uploaded PDF, such as a report downloaded from NSE or BSE.
      </p>
    </>
  );
}
