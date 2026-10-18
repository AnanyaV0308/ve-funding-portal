import { can, type FunderType, fyLabel } from "@ve/core";
import { db, donorLists, getFitSettings } from "@ve/db";
import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { NoAccess } from "@/components/no-access";
import { Notice } from "@/components/notice";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/authz";
import { formatDate } from "@/lib/format";
import { deleteDonorList } from "./actions";
import { DonorListForm } from "./donor-form";

export const metadata = { title: "Peer NGO donors" };

type Search = { added?: string; removed?: string };

const ADDED_AS: Partial<Record<FunderType, string>> = { company: "companies", foundation: "foundations or trusts", hni: "individuals" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function DonorListsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser();
  if (!can(user.roles, "leads:view")) return <NoAccess what="CSR leads" />;
  const canEdit = can(user.roles, "leads:edit");
  const search = await searchParams;

  const [lists, settings, added] = await Promise.all([
    db.query.donorLists.findMany({ orderBy: desc(donorLists.createdAt), with: { creator: { columns: { name: true, email: true } } } }),
    getFitSettings(),
    search.added && UUID.test(search.added) ? db.query.donorLists.findFirst({ where: eq(donorLists.id, search.added) }) : null,
  ]);
  const removed = search.removed === undefined ? null : Number(search.removed) || 0;

  return (
    <>
      <p>
        <Link href="/leads">
          <span aria-hidden="true">← </span>CSR leads
        </Link>
      </p>
      <PageHeader
        title="Peer NGO donors"
        intro="Companies that already fund NGOs like VE are the strongest sign of fit. Paste the donors a peer NGO lists in its annual report or on its website, and each company's fit score is worked out again."
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

      {canEdit ? (
        <section aria-labelledby="add-heading" className="grid gap-4 rounded-lg border border-ve-line bg-white p-5">
          <h2 id="add-heading" className="text-xl font-bold">
            Add a donor list
          </h2>
          <DonorListForm peers={settings.peerNgos} />
        </section>
      ) : null}

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
                        {l.donorCount - l.matchedCount} new, added as {ADDED_AS[l.newFunderType] ?? "funders"}
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
    </>
  );
}
