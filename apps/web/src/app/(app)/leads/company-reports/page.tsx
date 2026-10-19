import { can, dueReportFy, fyLabel } from "@ve/core";
import { companyReports, db, getCompaniesFollowed } from "@ve/db";
import { followedCompanies, readerConfigured } from "@ve/ingest";
import { desc, inArray } from "drizzle-orm";
import Link from "next/link";
import { FitBadge } from "@/components/eligibility-pill";
import { NoAccess } from "@/components/no-access";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/authz";
import { formatDate } from "@/lib/format";
import { companyReportStatus } from "../../funders/[id]/annual-report";
import { FollowForm } from "./follow-form";

export const metadata = { title: "Company annual reports" };

export default async function CompanyReportsPage() {
  const user = await requireUser();
  if (!can(user.roles, "leads:view")) return <NoAccess what="CSR leads" />;
  const isAdmin = can(user.roles, "settings:manage");

  const [followed, count] = await Promise.all([followedCompanies(), getCompaniesFollowed()]);
  const ids = followed.map((f) => f.id);
  const reports = ids.length
    ? await db.select().from(companyReports).where(inArray(companyReports.funderId, ids)).orderBy(desc(companyReports.fy), desc(companyReports.foundAt))
    : [];
  const readerReady = readerConfigured();
  const due = dueReportFy(new Date());
  const newestFor = (id: string) => reports.find((r) => r.funderId === id);
  const withDueYear = followed.filter((f) => reports.some((r) => r.funderId === f.id && r.status === "read" && r.fy && r.fy >= due)).length;

  return (
    <>
      <p>
        <Link href="/leads">
          <span aria-hidden="true">← </span>CSR leads
        </Link>
      </p>
      <PageHeader
        title="Company annual reports"
        intro="A listed company's annual report says what it had to spend on CSR, what it spent and often which NGOs ran its projects, a year or more before the National CSR Portal does. Every month the portal looks on the best-fitting companies' own websites for their newest report and reads its CSR pages. It never fetches from NSE or BSE, whose terms don't allow it."
      />

      {!readerReady ? (
        <p className="rounded-md bg-warn-soft p-3 text-warn">
          Looking for and reading reports needs an Anthropic API key, which isn&apos;t set up yet. Until then, nothing here changes on its own.
        </p>
      ) : null}

      <section aria-labelledby="followed-heading" className="grid gap-3">
        <h2 id="followed-heading" className="text-xl font-bold">
          Companies followed
        </h2>
        <p className="text-ve-muted">
          {followed.length
            ? `${followed.length} listed ${followed.length === 1 ? "company" : "companies"}, best fit first. ${withDueYear} of them have their ${fyLabel(due)} report read.`
            : "No listed companies to follow yet. Companies come from National CSR Portal imports; a CIN starting with L marks a listed one."}
        </p>
        {followed.length ? (
          <div className="relative overflow-x-auto rounded-lg border border-ve-line bg-white">
            <table className="w-full min-w-[44rem] text-left text-sm">
              <caption className="sr-only">Companies whose annual reports the portal follows, best fit first</caption>
              <thead className="bg-ve-cream">
                <tr>
                  <th scope="col" className="label px-3 py-2 text-xs text-ve-muted">
                    Fit
                  </th>
                  <th scope="col" className="label px-3 py-2 text-xs text-ve-muted">
                    Company
                  </th>
                  <th scope="col" className="label px-3 py-2 text-xs text-ve-muted">
                    Newest report
                  </th>
                  <th scope="col" className="label px-3 py-2 text-xs text-ve-muted">
                    Last looked
                  </th>
                </tr>
              </thead>
              <tbody>
                {followed.map((f) => {
                  const r = newestFor(f.id);
                  return (
                    <tr key={f.id} className="border-t border-ve-line align-top">
                      <td className="px-3 py-2">
                        <FitBadge score={f.fitScore} />
                      </td>
                      <th scope="row" className="px-3 py-2 font-medium">
                        <Link href={`/funders/${f.id}`}>{f.name}</Link>
                      </th>
                      <td className="px-3 py-2">
                        {r ? (
                          <>
                            {r.fy ? fyLabel(r.fy) : r.title}
                            <span className="block text-ve-muted">{companyReportStatus(r, readerReady)}</span>
                          </>
                        ) : (
                          <span className="text-ve-muted">None yet</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {f.reportCheckRequestedAt ? (
                          "In the next few minutes"
                        ) : f.reportCheckedAt ? (
                          <>
                            {formatDate(f.reportCheckedAt)}
                            <span className="block text-ve-muted">{f.reportCheckResult}</span>
                          </>
                        ) : (
                          <span className="text-ve-muted">{f.reportCheckResult ?? "Not yet"}</span>
                        )}
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
        Any company&apos;s page can also look for its report, or take a link or an uploaded PDF, such as one downloaded from NSE or BSE.
      </p>
    </>
  );
}
