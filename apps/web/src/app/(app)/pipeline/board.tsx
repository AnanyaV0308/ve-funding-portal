"use client";

import type { DueState, Stage } from "@ve/core";
import Link from "next/link";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { type MoveState, moveOnBoard } from "./actions";

export type BoardColumn = { stage: Stage; label: string; probability: number; weightedLabel: string; closed: boolean };

export type BoardCard = {
  id: string;
  stage: Stage;
  title: string;
  funderName: string;
  askLabel: string;
  ownerName: string | null;
  nextAction: string | null;
  dueLabel: string | null;
  due: DueState | null;
  daysInStage: number;
  stuck: boolean;
};

const DRAG_TYPE = "application/x-ve-pursuit";

const DUE_STYLES: Record<DueState, string> = {
  overdue: "bg-bad-soft text-bad",
  today: "bg-warn-soft text-warn",
  soon: "bg-ve-cream text-ve-olive",
  later: "text-ve-muted",
};

/**
 * The pipeline board. Every card has a "Stage" menu and a "Move" button, so nobody has to drag;
 * mouse users can also drag a card onto another column. Both go through the same server action.
 */
export function Board({ columns, cards, canEdit }: { columns: BoardColumn[]; cards: BoardCard[]; canEdit: boolean }) {
  const [state, moveAction, pending] = useActionState<MoveState, FormData>(moveOnBoard, null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<Stage | null>(null);
  const lastState = useRef<MoveState>(null);

  // After a move, put focus on the card in its new column so keyboard and screen reader users keep their place.
  useEffect(() => {
    if (state && state !== lastState.current && state.movedId) {
      document.getElementById(`card-${state.movedId}`)?.focus();
    }
    lastState.current = state;
  }, [state]);

  function accept(e: React.DragEvent, stage: Stage) {
    if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setOver(stage);
  }

  function drop(stage: Stage, id: string | null) {
    setDragging(null);
    setOver(null);
    const card = cards.find((c) => c.id === id);
    if (!card || card.stage === stage) return;
    const fd = new FormData();
    fd.set("id", card.id);
    fd.set("stage", stage);
    startTransition(() => moveAction(fd));
  }

  return (
    <>
      <p role="status" aria-live="polite" className={state ? `rounded-md p-3 ${state.ok ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad"}` : "sr-only"}>
        {pending ? "Moving…" : (state?.message ?? "")}
      </p>
      {/* relative: keeps the absolutely positioned sr-only text inside the scroller, so the page itself never scrolls sideways. */}
      <div role="region" aria-label="Pipeline board" tabIndex={0} className="relative -mx-1 overflow-x-auto px-1 pb-3">
        <div className="flex gap-3">
          {columns.map((col) => {
            const inCol = cards.filter((c) => c.stage === col.stage);
            return (
              <section
                key={col.stage}
                aria-labelledby={`col-${col.stage}`}
                data-stage={col.stage}
                // A column accepts a card only if both dragenter and dragover are cancelled.
                onDragEnter={canEdit ? (e) => accept(e, col.stage) : undefined}
                onDragOver={canEdit ? (e) => accept(e, col.stage) : undefined}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((s) => (s === col.stage ? null : s));
                }}
                onDrop={
                  canEdit
                    ? (e) => {
                        e.preventDefault();
                        drop(col.stage, e.dataTransfer.getData(DRAG_TYPE) || dragging);
                      }
                    : undefined
                }
                className={`flex w-72 shrink-0 flex-col gap-3 rounded-lg border-2 p-3 ${
                  over === col.stage ? "border-ve-olive bg-ve-yellow-soft" : col.closed ? "border-transparent bg-ve-line/40" : "border-transparent bg-ve-cream"
                }`}
              >
                <div>
                  <h2 id={`col-${col.stage}`} className="flex items-baseline justify-between gap-2 font-bold">
                    <span>{col.label}</span>{" "}
                    <span className="rounded-full bg-white px-2 text-sm font-medium">
                      {inCol.length}
                      <span className="sr-only"> {inCol.length === 1 ? "pursuit" : "pursuits"}</span>
                    </span>
                  </h2>
                  <p className="text-xs text-ve-muted">
                    {col.probability}% likely{col.closed ? "" : ` · ${col.weightedLabel} weighted`}
                  </p>
                </div>
                {inCol.length ? (
                  <ul className="grid gap-3">
                    {inCol.map((card) => (
                      <li
                        key={card.id}
                        draggable={canEdit}
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData(DRAG_TYPE, card.id);
                          // Changing the dragged element during dragstart can cancel the drag in Chrome.
                          setTimeout(() => setDragging(card.id), 0);
                        }}
                        onDragEnd={() => { setDragging(null); setOver(null); }}
                        className={`${canEdit ? "cursor-grab" : ""} ${dragging === card.id ? "opacity-60" : ""}`}
                      >
                        <Card card={card} columns={columns} canEdit={canEdit} moveAction={moveAction} pending={pending} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-ve-muted">None</p>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </>
  );
}

function Card({
  card,
  columns,
  canEdit,
  moveAction,
  pending,
}: {
  card: BoardCard;
  columns: BoardColumn[];
  canEdit: boolean;
  moveAction: (fd: FormData) => void;
  pending: boolean;
}) {
  return (
    <article aria-labelledby={`card-${card.id}`} className="grid gap-2 rounded-md border border-ve-line bg-white p-3 text-sm shadow-sm">
      <div>
        <h3 id={`card-${card.id}`} tabIndex={-1} className="text-base font-bold leading-snug">
          <Link href={`/pursuits/${card.id}`}>{card.title}</Link>
        </h3>
        <p className="text-ve-muted">{card.funderName}</p>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        <dt className="text-ve-muted">Ask</dt>
        <dd>{card.askLabel || "Not set"}</dd>
        <dt className="text-ve-muted">Owner</dt>
        <dd>{card.ownerName ?? "No owner"}</dd>
        <dt className="text-ve-muted">In stage</dt>
        <dd>
          {card.daysInStage} {card.daysInStage === 1 ? "day" : "days"}
          {card.stuck ? <span className="ml-2 rounded-full bg-warn-soft px-2 py-0.5 text-xs text-warn">Gone quiet</span> : null}
        </dd>
      </dl>
      {card.nextAction ? (
        <p>
          <span className="text-ve-muted">Next: </span>
          {card.nextAction}
          {card.dueLabel ? (
            <span className={`ml-1 inline-block rounded-full px-2 py-0.5 text-xs ${DUE_STYLES[card.due ?? "later"]}`}>{card.dueLabel}</span>
          ) : null}
        </p>
      ) : null}
      {canEdit ? (
        <form action={moveAction} className="flex items-end gap-2 border-t border-ve-line pt-2">
          <input type="hidden" name="id" value={card.id} />
          <div className="grid flex-1 gap-0.5">
            <label htmlFor={`stage-${card.id}`} className="text-xs text-ve-muted">
              Stage
            </label>
            <select
              id={`stage-${card.id}`}
              name="stage"
              defaultValue={card.stage}
              aria-label={`Stage for ${card.title}`}
              className="w-full rounded-md border border-ve-line bg-white px-2 py-1"
            >
              {columns.map((c) => (
                <option key={c.stage} value={c.stage}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn btn-secondary px-3 py-1" disabled={pending} aria-label={`Move ${card.title}`}>
            Move
          </button>
        </form>
      ) : null}
    </article>
  );
}
