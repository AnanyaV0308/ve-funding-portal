import {
  can,
  factStatus,
  KNOWLEDGE_CATEGORIES,
  KNOWLEDGE_CATEGORY_LABELS,
  type KnowledgeCategory,
  reviewDueDate,
} from "@ve/core";
import { db, knowledgeFacts } from "@ve/db";
import { asc } from "drizzle-orm";
import Link from "next/link";
import { NoAccess } from "@/components/no-access";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { requireUser } from "@/lib/authz";
import { formatDate } from "@/lib/format";
import { confirmFact } from "./actions";
import { KnowledgeTabs } from "./tabs";

export const metadata = { title: "Knowledge base" };

type Search = { category?: string; status?: string; saved?: string; deleted?: string };

export default async function KnowledgePage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser();
  if (!can(user.roles, "knowledge:view")) return <NoAccess what="the knowledge base" />;
  const canEdit = can(user.roles, "knowledge:edit");

  const params = await searchParams;
  const selected = KNOWLEDGE_CATEGORIES.find((c) => c === params.category);
  const needsAttention = params.status === "attention";

  const now = new Date();
  const all = (
    await db.query.knowledgeFacts.findMany({
      with: { owner: { columns: { name: true, email: true } } },
      orderBy: [asc(knowledgeFacts.category), asc(knowledgeFacts.title)],
    })
  ).map((f) => ({ ...f, status: factStatus(f, now) }));

  const attentionCount = all.filter((f) => f.status !== "current").length;
  const shown = all.filter(
    (f) => (!selected || f.category === selected) && (!needsAttention || f.status !== "current"),
  );
  const groups = KNOWLEDGE_CATEGORIES.map((c) => ({ category: c, facts: shown.filter((f) => f.category === c) })).filter(
    (g) => g.facts.length > 0,
  );

  const filterHref = (category?: KnowledgeCategory, attention = needsAttention) => {
    const q = new URLSearchParams();
    if (category) q.set("category", category);
    if (attention) q.set("status", "attention");
    const s = q.toString();
    return s ? `/knowledge?${s}` : "/knowledge";
  };

  return (
    <>
      <PageHeader
        title="VE knowledge base"
        intro="VE's facts, numbers and programme write-ups, each with its source and when someone last checked it. Drafts only use facts that are confirmed and in date."
      />
      <KnowledgeTabs current="facts" />

      {params.saved ? (
        <p role="status" className="rounded-md bg-ok-soft p-3 text-ok">
          Fact saved and marked as checked.
        </p>
      ) : null}
      {params.deleted ? (
        <p role="status" className="rounded-md bg-ok-soft p-3 text-ok">
          Fact deleted.
        </p>
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-4">
        <p className="text-ve-muted">
          {all.length} facts · <strong className="text-ve-charcoal">{attentionCount}</strong> need checking
        </p>
        {canEdit ? (
          <Link href="/knowledge/facts/new" className="btn btn-primary no-underline">
            Add a fact
          </Link>
        ) : null}
      </div>

      <nav aria-label="Filter facts" className="grid gap-2">
        <ul className="flex flex-wrap gap-2">
          <FilterChip href={filterHref(undefined)} active={!selected} label="All categories" />
          {KNOWLEDGE_CATEGORIES.map((c) => (
            <FilterChip key={c} href={filterHref(c)} active={selected === c} label={KNOWLEDGE_CATEGORY_LABELS[c].name} />
          ))}
        </ul>
        <ul className="flex flex-wrap gap-2">
          <FilterChip href={filterHref(selected, false)} active={!needsAttention} label="Any status" />
          <FilterChip href={filterHref(selected, true)} active={needsAttention} label="Needs checking" />
        </ul>
      </nav>

      {groups.length === 0 ? (
        <section className="grid max-w-prose gap-2 rounded-lg border border-dashed border-ve-line bg-white p-6">
          <h2 className="text-lg font-bold">Nothing here yet</h2>
          <p className="text-ve-muted">
            {needsAttention ? "Every fact in this view is confirmed and in date." : "No facts in this category yet."}
            {canEdit ? " Use “Add a fact” to add one." : null}
          </p>
        </section>
      ) : null}

      {groups.map((g) => (
        <section key={g.category} aria-labelledby={`h-${g.category}`} className="grid gap-3">
          <div>
            <h2 id={`h-${g.category}`} className="text-xl font-bold">
              {KNOWLEDGE_CATEGORY_LABELS[g.category].name}
            </h2>
            <p className="text-sm text-ve-muted">{KNOWLEDGE_CATEGORY_LABELS[g.category].description}</p>
          </div>
          <div className="relative overflow-x-auto rounded-lg border border-ve-line bg-white">
            <table className="w-full min-w-[46rem] text-left text-sm">
              <caption className="sr-only">{KNOWLEDGE_CATEGORY_LABELS[g.category].name}</caption>
              <thead className="bg-ve-cream">
                <tr>
                  <th scope="col" className="label px-3 py-2 text-xs text-ve-muted">Fact</th>
                  <th scope="col" className="label px-3 py-2 text-xs text-ve-muted">Detail</th>
                  <th scope="col" className="label px-3 py-2 text-xs text-ve-muted">As of</th>
                  <th scope="col" className="label px-3 py-2 text-xs text-ve-muted">Source</th>
                  <th scope="col" className="label px-3 py-2 text-xs text-ve-muted">Status</th>
                  {canEdit ? <th scope="col" className="label px-3 py-2 text-xs text-ve-muted"><span className="sr-only">Actions</span></th> : null}
                </tr>
              </thead>
              <tbody>
                {g.facts.map((f) => (
                  <tr key={f.id} className="border-t border-ve-line align-top">
                    <th scope="row" className="px-3 py-3 font-medium">
                      {canEdit ? <Link href={`/knowledge/facts/${f.id}`}>{f.title}</Link> : f.title}
                    </th>
                    <td className="max-w-md px-3 py-3 whitespace-pre-line">{f.body}</td>
                    <td className="px-3 py-3 whitespace-nowrap">{formatDate(f.asOf)}</td>
                    <td className="px-3 py-3">
                      {f.sourceUrl ? <a href={f.sourceUrl} target="_blank" rel="noreferrer">{f.sourceLabel ?? "Link"}<span className="sr-only"> (opens in a new tab)</span></a> : (f.sourceLabel ?? <span className="text-ve-muted">None</span>)}
                    </td>
                    <td className="px-3 py-3">
                      <StatusPill status={f.status} />
                      <p className="mt-1 text-xs text-ve-muted">
                        {f.confirmedAt
                          ? `Checked ${formatDate(f.confirmedAt)} · next by ${formatDate(reviewDueDate(f.confirmedAt, f.refreshMonths))}`
                          : "Not checked by VE yet"}
                      </p>
                    </td>
                    {canEdit ? (
                      <td className="px-3 py-3">
                        {f.status !== "current" ? (
                          <form action={confirmFact}>
                            <input type="hidden" name="id" value={f.id} />
                            <button
                              type="submit"
                              aria-label={`Still correct: ${f.title}`}
                              className="btn btn-secondary px-3 py-1 text-xs whitespace-nowrap"
                            >
                              Still correct
                            </button>
                          </form>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </>
  );
}

function FilterChip({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <li>
      <Link
        href={href}
        aria-current={active ? "true" : undefined}
        className={`inline-block rounded-full border px-3 py-1 text-sm no-underline ${
          active ? "border-ve-yellow bg-ve-yellow text-ve-on-yellow" : "border-ve-line bg-white text-ve-charcoal hover:bg-ve-cream"
        }`}
      >
        {label}
      </Link>
    </li>
  );
}
