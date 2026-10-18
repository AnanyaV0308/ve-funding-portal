import {
  can,
  defaultProbability,
  formatInrShort,
  isClosed,
  STAGES_BY_TRACK,
  stageLabel,
  type Track,
  TRACK_LABELS,
  TRACKS,
} from "@ve/core";
import Link from "next/link";
import { NoAccess } from "@/components/no-access";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/authz";
import { dueLabel, listPursuits, type PursuitRow, sumWeighted } from "@/lib/pipeline";
import { Board, type BoardCard } from "./board";

export const metadata = { title: "Pipeline" };

type Search = { track?: string; view?: string; mine?: string };

export default async function PipelinePage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser();
  if (!can(user.roles, "pipeline:view")) return <NoAccess what="the pipeline" />;
  const canEdit = can(user.roles, "pipeline:edit");

  const params = await searchParams;
  const track: Track = TRACKS.find((t) => t === params.track) ?? "relationship";
  const view = params.view === "table" ? "table" : "board";
  const mine = params.mine === "1";

  const rows = await listPursuits({ track, ownerId: mine ? user.id : undefined });
  const open = rows.filter((r) => !r.closed);
  const overdue = open.filter((r) => r.due === "overdue").length;

  const href = (next: Partial<{ track: Track; view: string; mine: boolean }>) => {
    const q = new URLSearchParams();
    const t = next.track ?? track;
    const v = next.view ?? view;
    const m = next.mine ?? mine;
    if (t !== "relationship") q.set("track", t);
    if (v !== "board") q.set("view", v);
    if (m) q.set("mine", "1");
    const s = q.toString();
    return s ? `/pipeline?${s}` : "/pipeline";
  };

  return (
    <>
      <PageHeader
        title="Pipeline"
        intro="Every funder VE is pursuing, by stage, with an owner, an ask and a next action. Relationships are CSR and philanthropy conversations; applications are awards and grant calls with a form to submit."
      />

      <nav aria-label="Pipeline tracks">
        <ul className="flex gap-1 border-b border-ve-line">
          {TRACKS.map((t) => (
            <li key={t}>
              <Link
                href={href({ track: t })}
                aria-current={t === track ? "page" : undefined}
                className={`-mb-px block border-b-4 px-4 py-2 no-underline ${
                  t === track ? "border-ve-yellow font-medium text-ve-charcoal" : "border-transparent text-ve-muted hover:text-ve-charcoal"
                }`}
              >
                {TRACK_LABELS[t]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-ve-muted">
          <strong className="text-ve-charcoal">{open.length}</strong> open ·{" "}
          <strong className="text-ve-charcoal">{formatInrShort(sumWeighted(rows)) || "₹0"}</strong> weighted ·{" "}
          <strong className={overdue ? "text-bad" : "text-ve-charcoal"}>{overdue}</strong> next{" "}
          {overdue === 1 ? "action" : "actions"} overdue
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <nav aria-label="Pipeline view">
            <ul className="flex gap-2">
              <Chip href={href({ view: "board" })} active={view === "board"} label="Board" />
              <Chip href={href({ view: "table" })} active={view === "table"} label="Table" />
              <Chip href={href({ mine: !mine })} active={mine} label="Only mine" pressed />
            </ul>
          </nav>
          {canEdit ? (
            <Link href={`/pursuits/new?track=${track}`} className="btn btn-primary no-underline">
              Add a pursuit
            </Link>
          ) : null}
        </div>
      </div>

      {rows.length === 0 ? (
        <section className="grid max-w-prose gap-2 rounded-lg border border-dashed border-ve-line bg-white p-6">
          <h2 className="text-lg font-bold">No pursuits here yet</h2>
          <p className="text-ve-muted">
            {mine ? "You don't own any pursuits on this track." : "Nothing on this track yet."}
            {canEdit ? " Use “Add a pursuit” to start one." : null}
          </p>
        </section>
      ) : view === "board" ? (
        <Board
          canEdit={canEdit}
          columns={STAGES_BY_TRACK[track].map((stage) => ({
            stage,
            label: stageLabel(stage),
            probability: defaultProbability(stage),
            weightedLabel: formatInrShort(sumWeighted(rows.filter((r) => r.stage === stage))) || "₹0",
            closed: isClosed(stage),
          }))}
          cards={rows.map(toCard)}
        />
      ) : (
        <PipelineTable rows={rows} track={track} />
      )}
    </>
  );
}

function toCard(r: PursuitRow): BoardCard {
  return {
    id: r.id,
    stage: r.stage,
    title: r.title,
    funderName: r.funder.name,
    askLabel: formatInrShort(r.askAmount),
    ownerName: r.ownerName,
    nextAction: r.nextAction,
    dueLabel: dueLabel(r),
    due: r.due,
    daysInStage: r.daysInStage,
    stuck: r.stuck,
  };
}

function PipelineTable({ rows, track }: { rows: PursuitRow[]; track: Track }) {
  const th = "label px-3 py-2 text-xs text-ve-muted";
  return (
    <div className="relative overflow-x-auto rounded-lg border border-ve-line bg-white" role="region" aria-label="Pipeline table" tabIndex={0}>
      <table className="w-full min-w-[64rem] text-left text-sm">
        <caption className="sr-only">{TRACK_LABELS[track]}, in stage order</caption>
        <thead className="bg-ve-cream">
          <tr>
            <th scope="col" className={th}>Pursuit</th>
            <th scope="col" className={th}>Funder</th>
            <th scope="col" className={th}>Stage</th>
            <th scope="col" className={th}>Owner</th>
            <th scope="col" className={`${th} text-right`}>Ask</th>
            <th scope="col" className={`${th} text-right`}>Likely</th>
            <th scope="col" className={`${th} text-right`}>Weighted</th>
            <th scope="col" className={th}>Next action</th>
            <th scope="col" className={`${th} text-right`}>Days in stage</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-ve-line align-top">
              <th scope="row" className="px-3 py-3 font-medium">
                <Link href={`/pursuits/${r.id}`}>{r.title}</Link>
              </th>
              <td className="px-3 py-3">{r.funder.name}</td>
              <td className="px-3 py-3 whitespace-nowrap">{stageLabel(r.stage)}</td>
              <td className="px-3 py-3">{r.ownerName ?? <span className="text-ve-muted">No owner</span>}</td>
              <td className="px-3 py-3 text-right whitespace-nowrap">{formatInrShort(r.askAmount) || <span className="text-ve-muted">Not set</span>}</td>
              <td className="px-3 py-3 text-right">{r.probability}%</td>
              <td className="px-3 py-3 text-right whitespace-nowrap">{r.closed ? "" : formatInrShort(r.weighted)}</td>
              <td className="px-3 py-3">
                {r.nextAction ?? <span className="text-ve-muted">None</span>}
                {r.nextActionDue ? (
                  <span className={`block text-xs ${r.due === "overdue" ? "font-medium text-bad" : "text-ve-muted"}`}>{dueLabel(r)}</span>
                ) : null}
              </td>
              <td className="px-3 py-3 text-right">
                {r.daysInStage}
                {r.stuck ? <span className="block text-xs text-warn">Gone quiet</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Chip({ href, active, label, pressed }: { href: string; active: boolean; label: string; pressed?: boolean }) {
  return (
    <li>
      <Link
        href={href}
        aria-current={!pressed && active ? "true" : undefined}
        className={`inline-block rounded-full border px-3 py-1 text-sm no-underline ${
          active ? "border-ve-yellow bg-ve-yellow text-ve-on-yellow" : "border-ve-line bg-white text-ve-charcoal hover:bg-ve-cream"
        }`}
      >
        {pressed ? <span aria-hidden="true">{active ? "✓ " : ""}</span> : null}
        {label}
        {pressed ? <span className="sr-only">{active ? " (on)" : " (off)"}</span> : null}
      </Link>
    </li>
  );
}
