"use client";

import { CHECK_ANSWER_LABELS, CHECK_ANSWERS, ELIGIBILITY_CHECK_LABELS, type EligibilityCheck } from "@ve/core";
import { useActionState } from "react";
import { describedBy, Field, inputClass } from "@/components/field";
import { type FormState, saveChecklist, skipCall } from "../actions";

export function ChecklistForm({ id, checks }: { id: string; checks: EligibilityCheck[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveChecklist, null);
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="id" value={id} />
      {checks.map((c) => {
        const { label, hint } = ELIGIBILITY_CHECK_LABELS[c.key];
        return (
          <fieldset key={c.key} className="grid gap-2 rounded-md border border-ve-line bg-white p-3" aria-describedby={`hint-${c.key}`}>
            <legend className="px-1 font-medium">{label}</legend>
            <p id={`hint-${c.key}`} className="text-sm text-ve-muted">
              {hint}
            </p>
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              {[...CHECK_ANSWERS, ""].map((a) => (
                <label key={a || "none"} className="flex items-center gap-2">
                  <input type="radio" name={`answer-${c.key}`} value={a} defaultChecked={(c.answer ?? "") === a} className="accent-ve-olive" />
                  {a ? CHECK_ANSWER_LABELS[a as (typeof CHECK_ANSWERS)[number]] : "Not checked yet"}
                </label>
              ))}
            </div>
            <div className="grid gap-1">
              <label htmlFor={`note-${c.key}`} className="text-sm font-medium">
                Note (optional)
              </label>
              <input id={`note-${c.key}`} name={`note-${c.key}`} defaultValue={c.note ?? ""} className={inputClass} />
            </div>
          </fieldset>
        );
      })}
      <div>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Saving…" : "Save checklist"}
        </button>
      </div>
      {state && !state.ok ? (
        <p role="alert" className="rounded-md bg-bad-soft p-3 text-bad">
          {state.message}
        </p>
      ) : null}
      <p role="status" className={state?.ok ? "rounded-md bg-ok-soft p-3 text-ok" : "sr-only"}>
        {state?.ok ? state.message : ""}
      </p>
    </form>
  );
}

export function SkipForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(skipCall, null);
  const err = state?.fieldErrors ?? {};
  return (
    <form action={action} className="grid gap-3" noValidate>
      <input type="hidden" name="id" value={id} />
      <Field id="reason" label="Why skip it?" hint="Skipped calls get no reminders and drop off the calendar. You can undo this." error={err.reason}>
        <textarea
          id="reason"
          name="reason"
          rows={2}
          defaultValue={state?.values?.reason ?? ""}
          className={inputClass}
          aria-invalid={Boolean(err.reason)}
          aria-describedby={describedBy("reason", { hint: true, error: err.reason })}
        />
      </Field>
      {state && !state.ok ? (
        <p role="alert" className="rounded-md bg-bad-soft p-3 text-bad">
          {state.message}
        </p>
      ) : null}
      <div>
        <button type="submit" className="btn btn-secondary" disabled={pending}>
          {pending ? "Skipping…" : "Skip this call"}
        </button>
      </div>
    </form>
  );
}
