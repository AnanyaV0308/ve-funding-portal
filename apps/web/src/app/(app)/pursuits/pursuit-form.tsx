"use client";

import {
  FUNDER_TYPE_LABELS,
  FUNDER_TYPES,
  firstStage,
  isClosed,
  STAGES_BY_TRACK,
  stageLabel,
  type Track,
  TRACK_LABELS,
  TRACKS,
} from "@ve/core";
import { useActionState, useEffect, useState } from "react";
import { describedBy, Field, inputClass } from "@/components/field";
import { createPursuit, type FormState } from "../pipeline/actions";

type Option = { id: string; name: string };

export function NewPursuitForm({
  funders,
  people,
  defaultTrack,
  defaultOwnerId,
  defaultFunderId,
}: {
  funders: Option[];
  people: Option[];
  defaultTrack: Track;
  defaultOwnerId: string;
  /** Set when someone starts a pursuit from a funder's page. */
  defaultFunderId?: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(createPursuit, null);
  const initialFunder = defaultFunderId ?? (funders.length ? "" : "__new");
  const [funderId, setFunderId] = useState(initialFunder);
  const [track, setTrack] = useState<Track>(defaultTrack);
  const err = state?.fieldErrors ?? {};
  // React resets a form after its action runs, so every field is uncontrolled with a defaultValue,
  // and after a validation error the defaults are what was typed. A select only takes its
  // defaultValue when it mounts, so each one is keyed on it. State only drives what is shown.
  const v = (key: string, fallback = "") => state?.values?.[key] ?? fallback;
  useEffect(() => {
    if (!state?.values) return;
    setFunderId(state.values.funderId ?? "");
    if (state.values.track) setTrack(state.values.track as Track);
  }, [state]);

  return (
    <form action={action} className="grid max-w-2xl gap-5" noValidate>
      {state && !state.ok ? (
        <p role="alert" className="rounded-md bg-bad-soft p-3 text-bad">
          {state.message}
        </p>
      ) : null}

      <fieldset className="grid gap-4 rounded-lg border border-ve-line bg-white p-4">
        <legend className="px-1 font-bold">Funder</legend>
        <Field id="funderId" label="Funder" error={err.funderId}>
          <select
            key={`funderId-${v("funderId", initialFunder)}`}
            id="funderId"
            name="funderId"
            defaultValue={v("funderId", initialFunder)}
            onChange={(e) => setFunderId(e.target.value)}
            className={inputClass}
            aria-invalid={Boolean(err.funderId)}
            aria-describedby={describedBy("funderId", { error: err.funderId })}
          >
            <option value="">Choose a funder</option>
            {funders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
            <option value="__new">Add a new funder…</option>
          </select>
        </Field>
        {funderId === "__new" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="newFunderName" label="New funder's name" error={err.newFunderName}>
              <input
                id="newFunderName"
                name="newFunderName"
                defaultValue={v("newFunderName")}
                className={inputClass}
                aria-invalid={Boolean(err.newFunderName)}
                aria-describedby={describedBy("newFunderName", { error: err.newFunderName })}
              />
            </Field>
            <Field id="newFunderType" label="Type" error={err.newFunderType}>
              <select
                key={`newFunderType-${v("newFunderType")}`}
                id="newFunderType"
                name="newFunderType"
                defaultValue={v("newFunderType")}
                className={inputClass}
                aria-invalid={Boolean(err.newFunderType)}
                aria-describedby={describedBy("newFunderType", { error: err.newFunderType })}
              >
                <option value="">Choose a type</option>
                {FUNDER_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {FUNDER_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        ) : null}
      </fieldset>

      <Field id="title" label="What VE is asking for" hint="e.g. “STEM labs in 20 schools, FY 2026-27”." error={err.title}>
        <input
          id="title"
          name="title"
          defaultValue={v("title")}
          className={inputClass}
          aria-invalid={Boolean(err.title)}
          aria-describedby={describedBy("title", { hint: true, error: err.title })}
        />
      </Field>

      <fieldset className="grid gap-2">
        <legend className="font-medium">Track</legend>
        <div className="flex flex-wrap gap-4">
          {TRACKS.map((t) => (
            <label key={t} className="flex items-center gap-2">
              <input
                type="radio"
                name="track"
                value={t}
                defaultChecked={v("track", defaultTrack) === t}
                onChange={() => setTrack(t)}
              />
              {TRACK_LABELS[t]}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="stage" label="Stage" error={err.stage}>
          <select
            key={`stage-${track}-${v("stage")}`}
            id="stage"
            name="stage"
            defaultValue={state?.values?.track === track ? state.values.stage : firstStage(track)}
            className={inputClass}
            aria-describedby={describedBy("stage", { error: err.stage })}
          >
            {STAGES_BY_TRACK[track]
              .filter((s) => !isClosed(s))
              .map((s) => (
                <option key={s} value={s}>
                  {stageLabel(s)}
                </option>
              ))}
          </select>
        </Field>
        <Field id="ownerId" label="Owner" error={err.ownerId}>
          <select key={`ownerId-${v("ownerId", defaultOwnerId)}`} id="ownerId" name="ownerId" defaultValue={v("ownerId", defaultOwnerId)} className={inputClass}>
            <option value="">No owner yet</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field id="askAmount" label="Ask (optional)" hint="In rupees. You can write 40 lakh, 1.5 crore or 4000000." error={err.askAmount}>
        <input
          id="askAmount"
          name="askAmount"
          defaultValue={v("askAmount")}
          inputMode="decimal"
          className={inputClass}
          aria-invalid={Boolean(err.askAmount)}
          aria-describedby={describedBy("askAmount", { hint: true, error: err.askAmount })}
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-[2fr_1fr]">
        <Field id="nextAction" label="Next action (optional)" hint="The very next thing someone will do." error={err.nextAction}>
          <input
            id="nextAction"
            name="nextAction"
            defaultValue={v("nextAction")}
            className={inputClass}
            aria-describedby={describedBy("nextAction", { hint: true, error: err.nextAction })}
          />
        </Field>
        <Field id="nextActionDue" label="Due (optional)" error={err.nextActionDue}>
          <input
            id="nextActionDue"
            name="nextActionDue"
            type="date"
            defaultValue={v("nextActionDue")}
            className={inputClass}
            aria-describedby={describedBy("nextActionDue", { error: err.nextActionDue })}
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Adding…" : "Add pursuit"}
        </button>
        <a href={`/pipeline${track === "relationship" ? "" : `?track=${track}`}`} className="btn btn-secondary no-underline">
          Cancel
        </a>
      </div>
    </form>
  );
}
