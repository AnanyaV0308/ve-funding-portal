import { cinIsListed, formatInrShort, fyLabel, PARTNER_LEFT_OUT_REASONS, pageRanges } from "@ve/core";
import type { companyReports } from "@ve/db";
import { formatDate } from "@/lib/format";
import { lookForReport, removeReport, retryReportRead } from "../report-actions";
import { ReportLinkForm, ReportUploadForm } from "./report-forms";

type Report = typeof companyReports.$inferSelect;

/** What has happened to a report, in words. */
export function companyReportStatus(r: Pick<Report, "status" | "error" | "readAt">, readerReady: boolean): string {
  switch (r.status) {
    case "waiting":
      return readerReady ? "Waiting to be read" : "Waiting for an Anthropic API key to be read";
    case "reading":
      return "Being read now";
    case "read":
      return `Read ${formatDate(r.readAt)}`;
    case "no_csr":
      return "Read: it has no CSR section";
    case "failed":
      return `Couldn't be read. ${r.error ?? ""}`.trim();
  }
}

/** A link to a page of a report on the web, or just the page number for an upload. */
function PageRef({ report, page }: { report: Report; page: number | null }) {
  if (!page) return null;
  if (!report.url) return <span className="text-ve-muted"> · page {page}</span>;
  return (
    <>
      {" · "}
      <a href={`${report.url}#page=${page}`} target="_blank" rel="noreferrer">
        page {page}
        <span className="sr-only"> of the report (opens in a new tab)</span>
      </a>
    </>
  );
}

function Figures({ report }: { report: Report }) {
  const year = report.fy ? ` for ${fyLabel(report.fy)}` : "";
  const rows = [
    { label: `CSR obligation${year}`, value: report.obligation },
    { label: "Spent", value: report.spent },
    { label: "Moved to its Unspent CSR Account", value: report.unspent },
  ];
  return (
    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-3">
      {rows.map((r) => (
        <div key={r.label}>
          <dt className="label text-xs text-ve-muted">{r.label}</dt>
          <dd className="font-medium">{r.value !== null ? formatInrShort(r.value) || "₹0" : <span className="font-normal text-ve-muted">Not given</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

function ReadReport({ report, added }: { report: Report; added: number }) {
  return (
    <div className="grid gap-3 rounded-lg border border-ve-line bg-white p-4">
      <div>
        <h3 className="font-bold">
          {report.url ? (
            <a href={report.url} target="_blank" rel="noreferrer">
              {report.title}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : (
            report.title
          )}
        </h3>
        <p className="text-sm text-ve-muted">
          Read {formatDate(report.readAt)}
          {report.pagesRead?.length ? `, from pages ${pageRanges(report.pagesRead)}${report.pages ? ` of ${report.pages}` : ""}` : ""}.
          {report.origin === "search" ? " Found on the company's website." : report.origin === "upload" ? " Uploaded." : ""}
        </p>
      </div>
      <Figures report={report} />
      {report.policyUrl ? (
        <p>
          <a href={report.policyUrl} target="_blank" rel="noreferrer">
            Its CSR policy and approved projects
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </p>
      ) : null}
      <div className="grid gap-1">
        <h4 className="font-bold">Work on disability</h4>
        {report.disabilityWork.length ? (
          <ul className="grid gap-1">
            {report.disabilityWork.map((d, i) => (
              <li key={i}>
                {d.description}
                {d.amountInr ? <span className="text-ve-muted"> · {formatInrShort(d.amountInr)}</span> : null}
                <PageRef report={report} page={d.page} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ve-muted">The CSR pages describe none.</p>
        )}
      </div>
      <p>{added === 1 ? "1 NGO it names was" : `${added} NGOs it names were`} added to the NGOs it funds, below.</p>
      {report.leftOut.length ? (
        <details>
          <summary className="cursor-pointer">
            Left out: {report.leftOut.length} {report.leftOut.length === 1 ? "organisation" : "organisations"}
          </summary>
          <ul className="mt-2 grid gap-1">
            {report.leftOut.map((l) => (
              <li key={l.name}>
                {l.name} <span className="text-ve-muted">· {PARTNER_LEFT_OUT_REASONS[l.reason]}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/**
 * The company's own annual reports: what the newest one read says about its CSR, the others with
 * where they stand, and ways to look again or add one by hand.
 */
export function AnnualReportSection({
  funder,
  reports,
  addedByReport,
  followed,
  followedCount,
  readerReady,
  canEdit,
}: {
  funder: { id: string; name: string; cin: string | null; reportCheckedAt: Date | null; reportCheckRequestedAt: Date | null; reportCheckResult: string | null };
  reports: Report[];
  addedByReport: Map<string, number>;
  followed: boolean;
  followedCount: number;
  readerReady: boolean;
  canEdit: boolean;
}) {
  const newest = reports.find((r) => r.status === "read");
  const others = reports.filter((r) => r !== newest);
  const listed = cinIsListed(funder.cin);
  return (
    <section aria-labelledby="report-heading" className="grid content-start gap-3">
      <h2 id="report-heading" className="text-xl font-bold">
        Annual report
      </h2>
      <p className="text-sm text-ve-muted">
        What the company&apos;s own annual report says about its CSR, often a year ahead of the National CSR Portal. The NGOs it names count towards the fit
        score.{" "}
        {followed
          ? "The portal looks for it on the company's website every month until the year's report is in."
          : listed
            ? `The portal looks for the reports of the ${followedCount} best-fitting listed companies on its own, and this one isn't among them.`
            : "The portal looks only for listed companies' reports on its own, so add this one's by hand."}
      </p>

      {newest ? <ReadReport report={newest} added={addedByReport.get(newest.id) ?? 0} /> : null}

      {others.length ? (
        <ul className="grid gap-2" aria-label="Other annual reports">
          {others.map((r) => (
            <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-ve-line bg-white p-3">
              <div>
                <p className="font-medium">
                  {r.url ? (
                    <a href={r.url} target="_blank" rel="noreferrer">
                      {r.title}
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  ) : (
                    r.title
                  )}
                </p>
                <p className="text-sm text-ve-muted">
                  {companyReportStatus(r, readerReady)}
                  {r.status === "read" ? ` · ${addedByReport.get(r.id) ?? 0} NGOs added` : ""}
                </p>
              </div>
              {canEdit ? (
                <div className="flex flex-wrap gap-2">
                  {r.status === "failed" ? (
                    <form action={retryReportRead}>
                      <input type="hidden" name="id" value={r.id} />
                      <button type="submit" className="btn btn-secondary px-3 py-1 text-xs" aria-label={`Try reading ${r.title} again`}>
                        Try again
                      </button>
                    </form>
                  ) : null}
                  <form action={removeReport}>
                    <input type="hidden" name="id" value={r.id} />
                    <button type="submit" className="btn btn-secondary px-3 py-1 text-xs" aria-label={`Remove ${r.title} and the NGOs it added`}>
                      Remove
                    </button>
                  </form>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {!reports.length ? <p className="text-ve-muted">No annual report yet.</p> : null}

      <p className="text-sm" role="status">
        {funder.reportCheckRequestedAt
          ? "The portal will look for its newest report in the next few minutes."
          : funder.reportCheckedAt
            ? `Last looked on its website ${formatDate(funder.reportCheckedAt)}: ${funder.reportCheckResult ?? ""}`
            : (funder.reportCheckResult ?? "The portal hasn't looked on its website yet.")}
      </p>

      {canEdit ? (
        <>
          <div className="flex flex-wrap items-center gap-3">
            {newest ? (
              <form action={removeReport}>
                <input type="hidden" name="id" value={newest.id} />
                <button type="submit" className="btn btn-secondary" aria-label={`Remove ${newest.title} and the NGOs it added`}>
                  Remove this report
                </button>
              </form>
            ) : null}
            <form action={lookForReport}>
              <input type="hidden" name="funderId" value={funder.id} />
              <button type="submit" className="btn btn-secondary" disabled={Boolean(funder.reportCheckRequestedAt)}>
                Look for its newest report
              </button>
            </form>
          </div>
          <details className="rounded-lg border border-ve-line bg-white p-4">
            <summary className="cursor-pointer font-bold">Add a report by hand</summary>
            <div className="mt-3 grid gap-5">
              <ReportLinkForm funderId={funder.id} />
              <ReportUploadForm funderId={funder.id} />
            </div>
          </details>
        </>
      ) : null}
    </section>
  );
}
