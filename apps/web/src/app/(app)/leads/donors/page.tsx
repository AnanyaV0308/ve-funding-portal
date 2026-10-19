import { can, donorsToAdd, type FunderType, fyLabel } from "@ve/core";
import { db, donorLists, getFitSettings, peerReports } from "@ve/db";
import { matchKnownDonors, readerConfigured, reportLabel } from "@ve/ingest";
import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { NoAccess } from "@/components/no-access";
import { Notice } from "@/components/notice";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/authz";
import { formatDate } from "@/lib/format";
import { deleteDonorList } from "./actions";
import { DonorListForm } from "./donor-form";
import { requestCheck } from "./report-actions";
import { reportStatus } from "./report-status";
import { SourceForm } from "./source-form";

export const metadata = { title: "Peer NGO donors" };

type Search = { added?: string; removed?: string; dismissed?: string; checking?: string };

const ADDED_AS: Partial<Record<FunderType, string>> = { company: "companies", foundation: "foundations or trusts", hni: "individuals" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function DonorListsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser();
  if (!can(user.roles, "leads:view")) return <NoAccess what="CSR leads" />;
  const canEdit = can(user.roles, "leads:edit");
  const search = await searchParams;

  const [lists, settings, added, sources, reports] = await Promise.all([
    db.query.donorLists.findMany({ orderBy: desc(donorLists.createdAt), with: { creator: { columns: { name: true, email: true } } } }),
    getFitSettings(),
    search.added && UUID.test(search.added) ? db.query.donorLists.findFirst({ where: eq(donorLists.id, search.added) }) : null,
    db.query.peerSources.findMany(),
    db.query.peerReports.findMany({
      orderBy: desc(peerReports.foundAt),
      with: { source: { columns: { ngoName: true } }, donorLists: { columns: { createdAt: true } } },
    }),
  ]);
  const removed = search.removed === undefined ? null : Number(search.removed) || 0;
  const readerReady = readerConfigured();
  const addedAt = (r: (typeof reports)[number]) => r.donorLists[0]?.createdAt ?? null;
  // Reports read and waiting for someone to add their donors, with how many the portal already knows.
  const toCheck = await Promise.all(
    reports
      .filter((r) => r.status === "ready" && !addedAt(r))
      .map(async (r) => {
        const matches = await matchKnownDonors(donorsToAdd(r.donors).entries);
        return { ...r, total: matches.length, fresh: matches.filter((m) => m.match === "new").length };
      }),
  ).then((rows) => rows.filter((r) => r.total > 0));
  const sourceFor = (ngo: string) => sources.find((s) => s.ngoName === ngo);
  const newestReport = (sourceId: string | undefined) =>
    reports.filter((r) => r.sourceId === sourceId).sort((a, b) => (b.fy ?? "").localeCompare(a.fy ?? "") || b.foundAt.getTime() - a.foundAt.getTime())[0];

  return (
    <>
      <p>
        <Link href="/leads">
          <span aria-hidden="true">← </span>CSR leads
        </Link>
      </p>
      <PageHeader
        title="Peer NGO donors"
        intro="Companies that already fund NGOs like VE are the strongest sign of fit. Once a month the portal looks on each peer NGO's website for a new annual report and reads the donors in it. Someone checks each list once, then the companies' fit scores are worked out again."
      />

      {added ? (
        <Notice>
          Saved {added.ngoName}&apos;s donors: {added.donorCount} in all, {added.donorCount - added.matchedCount} of them new to the portal.
        </Notice>
      ) : null}
      {removed !== null ? (
        <Notice>
          List removed{removed ? `, with ${removed} ${removed === 1 ? "funder" : "funders"} it had added` : ""}. Fit scores are up to date.
        </Notice>
      ) : null}
      {search.dismissed ? <Notice>The report&apos;s donors weren&apos;t added. You can still add them from its page.</Notice> : null}
      {search.checking ? <Notice>The portal will look at {search.checking}&apos;s page in the next few minutes.</Notice> : null}
      {!readerReady ? (
        <p className="max-w-prose rounded-md bg-warn-soft p-3 text-warn">
          The portal finds new reports, but it can&apos;t read them until it has an Anthropic API key (ANTHROPIC_API_KEY in its settings file). Until
          then, you can add a list by hand at the bottom of this page.
        </p>
      ) : null}

      <section aria-labelledby="check-heading" className="grid gap-3">
        <h2 id="check-heading" className="text-xl font-bold">
          Donor lists to check <span className="text-base font-normal text-ve-muted">({toCheck.length})</span>
        </h2>
        {toCheck.length ? (
          <ul className="grid gap-2">
            {toCheck.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ve-line bg-white p-4">
                <span>
                  <span className="font-medium">{reportLabel(r.source.ngoName, r.fy)}</span>
                  <span className="block text-sm text-ve-muted">
                    {r.total} {r.total === 1 ? "donor" : "donors"} read, {r.fresh} new to the portal
                  </span>
                </span>
                <Link href={`/leads/donors/reports/${r.id}`} className="btn btn-primary text-sm">
                  Check<span className="sr-only"> {reportLabel(r.source.ngoName, r.fy)}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ve-muted">Nothing to check. New reports appear here once the portal has read them.</p>
        )}
      </section>

      <section aria-labelledby="where-heading" className="grid gap-3">
        <h2 id="where-heading" className="text-xl font-bold">
          Where the portal looks
        </h2>
        <p className="max-w-prose text-sm text-ve-muted">
          The page on each peer NGO&apos;s website that links to its annual reports. Admins change the peer list in Settings.
        </p>
        <div className="relative overflow-x-auto rounded-lg border border-ve-line bg-white" role="region" aria-label="Where the portal looks" tabIndex={0}>
          <table className="w-full min-w-[48rem] text-left text-sm">
            <thead>
              <tr className="border-b border-ve-line bg-ve-cream">
                <th scope="col" className="label px-3 py-2 text-xs text-ve-muted">
                  NGO
                </th>
                <th scope="col" className="label px-3 py-2 text-xs text-ve-muted">
                  Reports page
                </th>
                <th scope="col" className="label px-3 py-2 text-xs text-ve-muted">
                  Last looked
                </th>
                <th scope="col" className="label px-3 py-2 text-xs text-ve-muted">
                  Newest report
                </th>
              </tr>
            </thead>
            <tbody>
              {settings.peerNgos.map((ngo) => {
                const source = sourceFor(ngo);
                const newest = newestReport(source?.id);
                return (
                  <tr key={ngo} className="border-t border-ve-line align-top">
                    <th scope="row" className="px-3 py-3 font-medium">
                      {ngo}
                    </th>
                    <td className="px-3 py-3">
                      {canEdit ? (
                        <SourceForm ngo={ngo} url={source?.url ?? null} />
                      ) : source ? (
                        <a href={source.url} target="_blank" rel="noreferrer" className="break-all">
                          {source.url}
                          <span className="sr-only"> (opens in a new tab)</span>
                        </a>
                      ) : (
                        <span className="text-ve-muted">No link yet</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {source?.checkRequestedAt ? (
                        <span>Looking soon</span>
                      ) : source?.lastCheckedAt ? (
                        <>
                          {formatDate(source.lastCheckedAt)}
                          <span className={`block text-xs ${source.lastOk ? "text-ve-muted" : "text-bad"}`}>{source.lastResult}</span>
                        </>
                      ) : source ? (
                        <span className="text-ve-muted">Not yet</span>
                      ) : null}
                      {canEdit && source && !source.checkRequestedAt ? (
                        <form action={requestCheck} className="mt-1">
                          <input type="hidden" name="id" value={source.id} />
                          <button type="submit" className="btn btn-secondary px-3 py-1 text-xs" aria-label={`Look at ${ngo}'s page now`}>
                            Look now
                          </button>
                        </form>
                      ) : null}
                    </td>
                    <td className="px-3 py-3">
                      {newest ? (
                        <>
                          <Link href={`/leads/donors/reports/${newest.id}`}>{newest.fy ? fyLabel(newest.fy) : newest.title}</Link>
                          <span className="block text-xs text-ve-muted">{reportStatus(newest, addedAt(newest), readerReady)}</span>
                        </>
                      ) : (
                        <span className="text-ve-muted">None found</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="lists-heading" className="grid gap-3">
        <h2 id="lists-heading" className="text-xl font-bold">
          Donor lists added <span className="text-base font-normal text-ve-muted">({lists.length})</span>
        </h2>
        {lists.length ? (
          <div className="relative overflow-x-auto rounded-lg border border-ve-line bg-white">
            <table className="w-full min-w-[44rem] text-left text-sm">
              <thead>
                <tr className="border-b border-ve-line bg-ve-cream">
                  <th scope="col" className="label px-3 py-2 text-xs text-ve-muted">
                    NGO
                  </th>
                  <th scope="col" className="label px-3 py-2 text-xs text-ve-muted">
                    Where it comes from
                  </th>
                  <th scope="col" className="label px-3 py-2 text-xs text-ve-muted">
                    Donors
                  </th>
                  <th scope="col" className="label px-3 py-2 text-xs text-ve-muted">
                    Added
                  </th>
                  {canEdit ? (
                    <th scope="col" className="px-3 py-2">
                      <span className="sr-only">Remove</span>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {lists.map((l) => (
                  <tr key={l.id} className="border-t border-ve-line align-top">
                    <th scope="row" className="px-3 py-3 font-medium">
                      {l.ngoName}
                      {l.fy ? <span className="block text-xs font-normal text-ve-muted">{fyLabel(l.fy)}</span> : null}
                    </th>
                    <td className="px-3 py-3">
                      {l.sourceUrl ? (
                        <a href={l.sourceUrl} target="_blank" rel="noreferrer">
                          {l.sourceLabel}
                          <span className="sr-only"> (opens in a new tab)</span>
                        </a>
                      ) : (
                        l.sourceLabel
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {l.donorCount}
                      <span className="block text-xs text-ve-muted">
                        {l.peerReportId
                          ? `${l.donorCount - l.matchedCount} new, read from the report`
                          : `${l.donorCount - l.matchedCount} new, added as ${ADDED_AS[l.newFunderType] ?? "funders"}`}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3">
                      {formatDate(l.createdAt)}
                      <span className="block text-xs text-ve-muted">{l.creator?.name ?? l.creator?.email ?? ""}</span>
                    </td>
                    {canEdit ? (
                      <td className="px-3 py-3 text-right">
                        <form action={deleteDonorList}>
                          <input type="hidden" name="id" value={l.id} />
                          <button type="submit" className="btn btn-secondary px-3 py-1 text-xs" aria-label={`Remove ${l.ngoName}'s list from ${l.sourceLabel}`}>
                            Remove
                          </button>
                        </form>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-ve-muted">None yet.</p>
        )}
        <p className="max-w-prose text-sm text-ve-muted">
          Removing a list takes its NGO off each donor&apos;s record. Funders the list added go too, unless someone has since added CSR data,
          notes or a pursuit for them.
        </p>
      </section>

      {canEdit ? (
        <section aria-labelledby="add-heading" className="grid gap-4 rounded-lg border border-ve-line bg-white p-5">
          <h2 id="add-heading" className="text-xl font-bold">
            Add a list by hand
          </h2>
          <p className="max-w-prose text-sm text-ve-muted">For a list the portal can&apos;t find on its own, such as one an NGO emailed to VE.</p>
          <DonorListForm peers={settings.peerNgos} />
        </section>
      ) : null}
    </>
  );
}
