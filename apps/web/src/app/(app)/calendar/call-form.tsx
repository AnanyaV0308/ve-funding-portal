"use client";

import { CALL_KIND_LABELS, CALL_KINDS, FUNDER_TYPE_LABELS, FUNDER_TYPES } from "@ve/core";
import { useActionState, useEffect, useState } from "react";
import { describedBy, Field, inputClass } from "@/components/field";
import { createCall, type FormState, updateCall } from "./actions";

type Option = { id: string; name: string };

export type CallValues = {
  id: string;
  funderId: string;
  kind: string;
  title: string;
  url: string;
  opensOn: string;
  deadline: string;
  usualWindow: string;
  amount: string;
  amountNote: string;
  categories: string;
  notes: string;
};

/** Adds a call, or edits one when `initial` is given. */
export function CallForm({ organisers, initial, cancelHref }: { organisers: Option[]; initial?: CallValues; cancelHref: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(initial ? updateCall : createCall, null);
  const startFunder = initial?.funderId ?? "";
  const [funderId, setFunderId] = useState(startFunder);
  const err = state?.fieldErrors ?? {};
  // Uncontrolled fields so React's form reset doesn't wipe what was typed; after a validation error
  // the defaults are the submitted values, and selects are keyed so they pick them up.
  const v = (key: keyof CallValues | "newFunderName" | "newFunderType") => state?.values?.[key] ?? (initial as Record<string, string> | undefined)?.[key] ?? "";
  useEffect(() => {
    if (state?.values) setFunderId(state.values.funderId ?? "");
  }, [state]);

  const text = (id: keyof CallValues, label: string, opts: { hint?: string; type?: string; inputMode?: "url" | "decimal" } = {}) => (
    <Field id={id} label={label} hint={opts.hint} error={err[id]}>
      <input
        id={id}
        name={id}
        type={opts.type ?? "text"}
        inputMode={opts.inputMode}
        defaultValue={v(id)}
        className={inputClass}
        aria-invalid={Boolean(err[id])}
        aria-describedby={describedBy(id, { hint: Boolean(opts.hint), error: err[id] })}
      />
    </Field>
  );

  return (
    <form action={action} className="grid max-w-2xl gap-5" noValidate>
      {initial ? <input type="hidden" name="id" value={initial.id} /> : null}
      {state && !state.ok ? (
        <p role="alert" className="rounded-md bg-bad-soft p-3 text-bad">
          {state.message}
        </p>
      ) : null}

      <fieldset className="grid gap-4 rounded-lg border border-ve-line bg-white p-4">
        <legend className="px-1 font-bold">Who runs it</legend>
        <Field id="funderId" label="Organiser" error={err.funderId}>
          <select
            key={`funderId-${v("funderId")}`}
            id="funderId"
            name="funderId"
            defaultValue={v("funderId")}
            onChange={(e) => setFunderId(e.target.value)}
            className={inputClass}
            aria-invalid={Boolean(err.funderId)}
            aria-describedby={describedBy("funderId", { error: err.funderId })}
          >
            <option value="">Choose an organiser</option>
            {organisers.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
            <option value="__new">Add a new organiser…</option>
          </select>
        </Field>
        {funderId === "__new" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="newFunderName" label="New organiser's name" error={err.newFunderName}>
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
                defaultValue={v("newFunderType") || "award_body"}
                className={inputClass}
                aria-invalid={Boolean(err.newFunderType)}
                aria-describedby={describedBy("newFunderType", { error: err.newFunderType })}
              >
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

      <div className="grid gap-5 sm:grid-cols-[2fr_1fr]">
        {text("title", "Name of the call", { hint: "Include the year or category, e.g. “National Awards 2027, Best Institution”." })}
        <Field id="kind" label="Kind" error={err.kind}>
          <select key={`kind-${v("kind")}`} id="kind" name="kind" defaultValue={v("kind") || "award"} className={inputClass} aria-describedby={describedBy("kind", { error: err.kind })}>
            {CALL_KINDS.map((k) => (
              <option key={k} value={k}>
                {CALL_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {text("url", "Link to the call (optional)", { hint: "The organiser's own page, where the deadline is official.", type: "url", inputMode: "url" })}

      <fieldset className="grid gap-4">
        <legend className="font-medium">Dates</legend>
        <div className="grid gap-5 sm:grid-cols-2">
          {text("opensOn", "Opens on (optional)", { type: "date" })}
          {text("deadline", "Deadline (optional)", { hint: "Reminders go out 30, 14, 7 and 2 days before.", type: "date" })}
        </div>
        {text("usualWindow", "When it usually runs (optional)", { hint: "For a yearly award whose dates aren't out yet, e.g. “Usually mid-May to mid-July”." })}
      </fieldset>

      <div className="grid gap-5 sm:grid-cols-2">
        {text("amount", "Prize or grant (optional)", { hint: "In rupees. You can write 5 lakh or 500000.", inputMode: "decimal" })}
        {text("amountNote", "About the money (optional)", { hint: "e.g. “No cash prize” or “Up to 3 years”." })}
      </div>

      {text("categories", "Categories or themes (optional)")}

      <Field id="notes" label="Notes (optional)" error={err.notes}>
        <textarea id="notes" name="notes" rows={3} defaultValue={v("notes")} className={inputClass} aria-describedby={describedBy("notes", { error: err.notes })} />
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Saving…" : initial ? "Save changes" : "Add call"}
        </button>
        <a href={cancelHref} className="btn btn-secondary no-underline">
          Cancel
        </a>
      </div>
    </form>
  );
}
