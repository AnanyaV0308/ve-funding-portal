import {
  ACTIVITY_KIND_LABELS,
  can,
  defaultProbability,
  FUNDER_TYPE_LABELS,
  formatInrShort,
  isLost,
  STAGES_BY_TRACK,
  stageLabel,
  TRACK_LABELS,
} from "@ve/core";
import { db, pursuitActivities, pursuitStageChanges, pursuits } from "@ve/db";
import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { NoAccess } from "@/components/no-access";
import { Notice } from "@/components/notice";
import { requireUser } from "@/lib/authz";
import { formatDate, todayInIndia } from "@/lib/format";
import { listPeople } from "@/lib/people";
import { dueLabel, listPursuits } from "@/lib/pipeline";
import { movePursuit } from "../../pipeline/actions";
import { ActivityForm, CloseForm, DetailsForm } from "./forms";

type Params = { id: string };
type Search = { created?: string; moved?: string; close?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function load(id: string) {
  if (!UUID.test(id)) return null;
  return db.query.pursuits.findFirst({
    where: eq(pursuits.id, id),
    with: {
      funder: true,
      stageChanges: { orderBy: desc(pursuitStageChanges.changedAt), with: { changer: { columns: { name: true, email: true } } } },
      activities: {
        orderBy: [desc(pursuitActivities.occurredOn), desc(pursuitActivities.createdAt)],
        with: { author: { columns: { name: true, email: true } } },
      },
    },
  });
}

export async function generateMetadata({ params }: { params: Promise<Params> }) {
  const p = await load((await params).id);
  return { title: p ? p.title : "Pursuit not found" };
}

export default async function PursuitPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<Search> }) {
  const user = await requireUser();
  if (!can(user.roles, "pipeline:view")) return <NoAccess what="the pipeline" />;
  const canEdit = can(user.roles, "pipeline:edit");
  const { id } = await params;
  const search = await searchParams;

  const p = await load(id);
  if (!p) notFound();
  // The same numbers as the board, so the two never disagree.
  const row = (await listPursuits({ track: p.track })).find((r) => r.id === p.id)!;
  const people = canEdit ? await listPeople() : [];
  const closeStage = STAGES_BY_TRACK[p.track].find((s) => s === search.close && isLost(s) && s !== p.stage);
  const backHref = `/pipeline${p.track === "relationship" ? "" : `?track=${p.track}`}`;
  const by = (u: { name: string | null; email: string | null } | null) => (u ? ` · ${u.name ?? u.email}` : "");

  return (
    <>
      <p>
        <Link href={backHref}>
          <span aria-hidden="true">← </span>Pipeline: {TRACK_LABELS[p.track]}
        </Link>
      </p>
      <header className="grid gap-1">
        <h1 className="text-3xl font-bold text-ve-charcoal">{p.title}</h1>
        <p className="text-ve-muted">
          {can(user.roles, "leads:view") ? <Link href={`/funders/${p.funder.id}`}>{p.funder.name}</Link> : p.funder.name} ·{" "}
          {FUNDER_TYPE_LABELS[p.funder.type]}
        </p>
      </header>

      {search.created ? <Notice>Pursuit added.</Notice> : null}
      {search.moved ? <Notice>Moved to {stageLabel(p.stage)}.</Notice> : null}

      {canEdit && closeStage ? <CloseForm pursuitId={p.id} stage={closeStage} cancelHref={`/pursuits/${p.id}`} /> : null}

      <section aria-labelledby="summary-heading" className="grid gap-4 rounded-lg border border-ve-line bg-white p-5">
        <h2 id="summary-heading" className="sr-only">
          Summary
        </h2>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
          <Item term="Stage">
            <span className="inline-block rounded-full bg-ve-yellow px-2.5 py-0.5 font-medium text-ve-on-yellow">{stageLabel(p.stage)}</span>
            <span className="mt-1 block text-sm text-ve-muted">
              {row.daysInStage} {row.daysInStage === 1 ? "day" : "days"} in this stage
              {row.stuck ? ", gone quiet" : ""}
            </span>
          </Item>
          <Item term="Ask">{formatInrShort(p.askAmount) || "Not set"}</Item>
          <Item term="Weighted">
            {row.closed ? "Closed" : formatInrShort(row.weighted) || "₹0"}
            <span className="mt-1 block text-sm text-ve-muted">
              {row.probability}% chance{p.probabilityOverride !== null ? ", set by hand" : `, the ${stageLabel(p.stage)} default`}
            </span>
          </Item>
          <Item term="Owner">{row.ownerName ?? "No owner yet"}</Item>
          <Item term="Next action">
            {p.nextAction ?? "None"}
            {p.nextActionDue ? (
              <span className={`mt-1 block text-sm ${row.due === "overdue" ? "font-medium text-bad" : "text-ve-muted"}`}>{dueLabel(row)}</span>
            ) : null}
          </Item>
          {p.closedReason ? (
            <Item term="Why it closed">
              {p.closedReason}
              {p.revisitOn ? <span className="mt-1 block text-sm text-ve-muted">Try again from {formatDate(p.revisitOn)}</span> : null}
            </Item>
          ) : null}
        </dl>

        {canEdit ? (
          <form action={movePursuit} className="flex flex-wrap items-end gap-3 border-t border-ve-line pt-4">
            <input type="hidden" name="id" value={p.id} />
            <div className="grid gap-1">
              <label htmlFor="move-stage" className="font-medium">
                Move to stage
              </label>
              <select id="move-stage" name="stage" defaultValue={p.stage} className="rounded-md border border-ve-line bg-white px-3 py-2">
                {STAGES_BY_TRACK[p.track].map((s) => (
                  <option key={s} value={s}>
                    {stageLabel(s)} ({defaultProbability(s)}%)
                  </option>
                ))}
              </select>
            </div>
            <div className="grid min-w-60 flex-1 gap-1">
              <label htmlFor="move-note" className="font-medium">
                Note (optional)
              </label>
              <input id="move-note" name="note" className="rounded-md border border-ve-line bg-white px-3 py-2" />
            </div>
            <button type="submit" className="btn btn-primary">
              Move
            </button>
          </form>
        ) : null}
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        <div className="grid content-start gap-8">
          {canEdit ? (
            <section aria-labelledby="details-heading" className="grid gap-3">
              <h2 id="details-heading" className="text-xl font-bold">
                Details
              </h2>
              <DetailsForm
                people={people}
                values={{
                  id: p.id,
                  title: p.title,
                  ownerId: p.ownerId,
                  askAmount: p.askAmount,
                  probabilityOverride: p.probabilityOverride,
                  defaultProbability: defaultProbability(p.stage),
                  nextAction: p.nextAction,
                  nextActionDue: p.nextActionDue,
                }}
              />
            </section>
          ) : null}

          <section aria-labelledby="history-heading" className="grid gap-3">
            <h2 id="history-heading" className="text-xl font-bold">
              Stage history
            </h2>
            <ol className="grid gap-3 border-l-4 border-ve-yellow pl-4">
              {p.stageChanges.map((c) => (
                <li key={c.id}>
                  <p>
                    {c.fromStage ? (
                      <>
                        {stageLabel(c.fromStage)} <span aria-hidden="true">→</span>
                        <span className="sr-only"> to</span> <strong>{stageLabel(c.toStage)}</strong>
                      </>
                    ) : (
                      <>
                        Added at <strong>{stageLabel(c.toStage)}</strong>
                      </>
                    )}
                  </p>
                  <p className="text-sm text-ve-muted">
                    {formatDate(c.changedAt)}
                    {by(c.changer)}
                  </p>
                  {c.note ? <p className="text-sm whitespace-pre-line">{c.note}</p> : null}
                </li>
              ))}
            </ol>
          </section>
        </div>

        <section aria-labelledby="activity-heading" className="grid content-start gap-3">
          <h2 id="activity-heading" className="text-xl font-bold">
            Calls, meetings and notes
          </h2>
          {canEdit ? (
            <div className="rounded-lg border border-ve-line bg-white p-4">
              <ActivityForm pursuitId={p.id} today={todayInIndia()} />
            </div>
          ) : null}
          {p.activities.length ? (
            <ol className="grid gap-3">
              {p.activities.map((a) => (
                <li key={a.id} className="rounded-md border border-ve-line bg-white p-3">
                  <p className="text-sm text-ve-muted">
                    <span className="label text-xs text-ve-olive">{ACTIVITY_KIND_LABELS[a.kind]}</span> · {formatDate(a.occurredOn)}
                    {by(a.author)}
                  </p>
                  <p className="whitespace-pre-line">{a.summary}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-ve-muted">Nothing logged yet.</p>
          )}
        </section>
      </div>
    </>
  );
}

function Item({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="label text-xs text-ve-muted">{term}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}
