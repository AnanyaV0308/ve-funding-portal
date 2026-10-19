import { can, donorsToAdd, formatInrShort, LEFT_OUT_REASONS, type LeftOutReason } from "@ve/core";
import { db, peerReports } from "@ve/db";
import { matchKnownDonors, readerConfigured, reportLabel } from "@ve/ingest";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { NoAccess } from "@/components/no-access";
import { Notice } from "@/components/notice";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/authz";
import { formatDate } from "@/lib/format";
import { addReport, dismissPeerReport, retryPeerReport } from "../../report-actions";
import { reportStatus } from "../../report-status";

type Params = { id: string };
type Search = { retry?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function load(id: string) {
  if (!UUID.test(id)) return null;
  return db.query.peerReports.findFirst({
    where: eq(peerReports.id, id),
    with: {
      source: { columns: { ngoName: true } },
      decider: { columns: { name: true, email: true } },
      donorLists: { columns: { id: true, createdAt: true }, with: { creator: { columns: { name: true, email: true } } } },
    },
  });
}

export async function generateMetadata({ params }: { params: Promise<Params> }) {
  const report = await load((await params).id);
  return { title: report ? reportLabel(report.source.ngoName, report.fy) : "Report not found" };
}

export default async function PeerReportPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<Search> }) {
  const user = await requireUser();
  if (!can(user.roles, "leads:view")) return <NoAccess what="CSR leads" />;
  const canEdit = can(user.roles, "leads:edit");
  const search = await searchParams;
  const report = await load((await params).id);
  if (!report) notFound();

  const label = reportLabel(report.source.ngoName, report.fy);
  const list = report.donorLists[0] ?? null;
  const { entries, leftOut } = donorsToAdd(report.donors);
  const matches = await matchKnownDonors(entries);
  const fresh = matches.filter((m) => m.match === "new").length;
  const read = report.status === "ready" || report.status === "dismissed";
  const reasons = (Object.keys(LEFT_OUT_REASONS) as LeftOutReason[])
    .map((reason) => ({ reason, names: leftOut.filter((l) => l.reason === reason).map((l) => l.name) }))
    .filter((g) => g.names.length);
  const pageLink = (page: number) => `${report.url}#page=${page}`;

  return (
    <>
      <p>
        <Link href="/leads/donors">
          <span aria-hidden="true">← </span>Peer NGO donors
        </Link>
      </p>
      <PageHeader title={label} />
      {search.retry ? <Notice>The portal will try to read this report again in the next few minutes.</Notice> : null}

      <p className="flex flex-wrap gap-x-4 gap-y-1">
        <a href={report.url} target="_blank" rel="noreferrer">
          Open the report (PDF)<span className="sr-only"> (opens in a new tab)</span>
        </a>
        <span className="text-ve-muted">
          Found {formatDate(report.foundAt)}
          {report.readAt && report.status !== "waiting" && report.status !== "reading" ? `, read ${formatDate(report.readAt)}` : ""}
          {report.pages ? `. ${report.pages} pages` : ""}
          {report.pagesRead ? `; the portal read the ${report.pagesRead.length} that list donors` : ""}
        </span>
      </p>

      {list ? (
        <p className="rounded-md bg-ok-soft p-3 text-ok">
          These donors were added on {formatDate(list.createdAt)}
          {list.creator ? ` by ${list.creator.name ?? list.creator.email}` : ""}. Their fit scores take this NGO into account.
        </p>
      ) : report.status === "dismissed" ? (
        <p className="rounded-md bg-warn-soft p-3 text-warn">
          {report.decider ? `${report.decider.name ?? report.decider.email} chose` : "Someone chose"} not to add these donors
          {report.decidedAt ? ` on ${formatDate(report.decidedAt)}` : ""}. You can still add them.
        </p>
      ) : !read ? (
        <p className={`rounded-md p-3 ${report.status === "failed" ? "bg-bad-soft text-bad" : "bg-ve-paper"}`}>
          {reportStatus(report, null, readerConfigured())}
        </p>
      ) : null}

      {!read && report.status === "failed" && canEdit ? (
        <form action={retryPeerReport}>
          <input type="hidden" name="id" value={report.id} />
          <button type="submit" className="btn btn-secondary">
            Try reading it again
          </button>
        </form>
      ) : null}

      {read ? (
        <section aria-labelledby="donors-heading" className="grid gap-3">
          <h2 id="donors-heading" className="text-xl font-bold">
            {matches.length} {matches.length === 1 ? "donor" : "donors"} to add
          </h2>
          <p className="max-w-prose">
            {matches.length - fresh} already in the portal, {fresh} new.
            {fresh ? " New ones are added as the report describes them, and new companies are marked Needs check." : ""} Check a name against its page in the
            report if it looks wrong; the portal reads logos too, and can misread one.
          </p>
          {matches.length ? (
            <div
              tabIndex={0}
              role="region"
              aria-label="Donors read from the report"
              className="relative overflow-x-auto rounded-lg border border-ve-line bg-white"
            >
              <table className="w-full min-w-[40rem] text-left text-sm">
                <caption className="sr-only">Donors read from {label}, and how each matches the portal</caption>
                <thead>
                  <tr className="border-b border-ve-line bg-ve-cream">
                    <th scope="col" className="label px-3 py-2 text-xs text-ve-muted">
                      Donor as the report names it
                    </th>
                    <th scope="col" className="label px-3 py-2 text-xs text-ve-muted">
                      In the portal
                    </th>
                    <th scope="col" className="label px-3 py-2 text-right text-xs text-ve-muted">
                      Amount
                    </th>
                    <th scope="col" className="label px-3 py-2 text-xs text-ve-muted">
                      Page
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {matches.map((m) => (
                    <tr key={m.line} className="border-t border-ve-line align-top">
                      <th scope="row" className="px-3 py-2 font-normal">
                        {m.name}
                        {m.cin ? <span className="block text-xs text-ve-muted">CIN {m.cin}</span> : null}
                      </th>
                      <td className="px-3 py-2">
                        {m.funder ? (
                          <Link href={`/funders/${m.funder.id}`}>{m.funder.name}</Link>
                        ) : (
                          <span className="font-medium text-ve-olive">New {m.type === "foundation" ? "foundation" : "company"}</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">{formatInrShort(m.amount) || "–"}</td>
                      <td className="px-3 py-2">
                        {m.page ? (
                          <a href={pageLink(m.page)} target="_blank" rel="noreferrer" aria-label={`Page ${m.page} of the report (opens in a new tab)`}>
                            {m.page}
                          </a>
                        ) : (
                          "–"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {reasons.length ? (
            <div className="grid gap-2">
              <h3 className="font-bold">Left out ({leftOut.length})</h3>
              {reasons.map((g) => (
                <p key={g.reason} className="max-w-prose text-sm">
                  <span className="font-medium">{LEFT_OUT_REASONS[g.reason]}:</span> {g.names.join(", ")}
                </p>
              ))}
              <p className="max-w-prose text-sm text-ve-muted">To add any of these, use Add a list by hand on the Peer NGO donors page.</p>
            </div>
          ) : null}

          {canEdit && !list && matches.length ? (
            <div className="flex flex-wrap gap-3">
              <form action={addReport}>
                <input type="hidden" name="id" value={report.id} />
                <button type="submit" className="btn btn-primary">
                  {matches.length === 1 ? "Add this donor" : `Add these ${matches.length} donors`}
                </button>
              </form>
              {report.status === "ready" ? (
                <form action={dismissPeerReport}>
                  <input type="hidden" name="id" value={report.id} />
                  <button type="submit" className="btn btn-secondary">
                    Don&apos;t add them
                  </button>
                </form>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
