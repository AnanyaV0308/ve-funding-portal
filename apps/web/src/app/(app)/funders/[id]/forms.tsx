"use client";

import { useActionState } from "react";
import { describedBy, Field, inputClass } from "@/components/field";
import { addGrantee, type FormState, saveFunderNotes } from "../actions";

function Result({ state }: { state: FormState }) {
  return (
    <>
      {state && !state.ok ? (
        <p role="alert" className="rounded-md bg-bad-soft p-3 text-bad">
          {state.message}
        </p>
      ) : null}
      <p role="status" className={state?.ok ? "rounded-md bg-ok-soft p-3 text-ok" : "sr-only"}>
        {state?.ok ? state.message : ""}
      </p>
    </>
  );
}

export function NotesForm({ id, warmPath, isForeign }: { id: string; warmPath: string | null; isForeign: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveFunderNotes, null);
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="id" value={id} />
      <Field id="warmPath" label="Warm path" hint="Who at VE knows someone here, and how. Anything written here counts towards the fit score.">
        <textarea id="warmPath" name="warmPath" rows={2} defaultValue={warmPath ?? ""} className={inputClass} aria-describedby={describedBy("warmPath", { hint: true })} />
      </Field>
      <label className="flex items-start gap-2">
        <input type="checkbox" name="isForeign" defaultChecked={isForeign} className="mt-1.5" />
        <span>
          This is a foreign company or a multinational parent
          <span className="block text-sm text-ve-muted">VE can't accept its money without FCRA, so it's marked not eligible. Add its Indian entity instead.</span>
        </span>
      </label>
      <div>
        <button type="submit" className="btn btn-secondary" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      <Result state={state} />
    </form>
  );
}

export function GranteeForm({ funderId }: { funderId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(addGrantee, null);
  const err = state?.fieldErrors ?? {};
  const v = (k: string) => (state && !state.ok ? (state.values?.[k] ?? "") : "");
  return (
    <form action={action} className="grid gap-4" noValidate>
      <input type="hidden" name="funderId" value={funderId} />
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr]">
        <Field id="g-name" label="NGO" error={err.name}>
          <input id="g-name" name="name" defaultValue={v("name")} className={inputClass} aria-invalid={Boolean(err.name)} aria-describedby={describedBy("g-name", { error: err.name })} />
        </Field>
        <Field id="g-fy" label="Year (optional)" error={err.fy}>
          <input id="g-fy" name="fy" placeholder="2023-24" defaultValue={v("fy")} className={inputClass} aria-describedby={describedBy("g-fy", { error: err.fy })} />
        </Field>
        <Field id="g-amount" label="Amount (optional)" error={err.amount}>
          <input id="g-amount" name="amount" inputMode="decimal" defaultValue={v("amount")} className={inputClass} aria-describedby={describedBy("g-amount", { error: err.amount })} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="g-sourceLabel" label="Source (optional)" error={err.sourceLabel}>
          <input id="g-sourceLabel" name="sourceLabel" placeholder="e.g. Annual report 2023-24, CSR annexure" defaultValue={v("sourceLabel")} className={inputClass} />
        </Field>
        <Field id="g-sourceUrl" label="Source link (optional)" error={err.sourceUrl}>
          <input id="g-sourceUrl" name="sourceUrl" type="url" inputMode="url" defaultValue={v("sourceUrl")} className={inputClass} aria-invalid={Boolean(err.sourceUrl)} aria-describedby={describedBy("g-sourceUrl", { error: err.sourceUrl })} />
        </Field>
      </div>
      <div>
        <button type="submit" className="btn btn-secondary" disabled={pending}>
          {pending ? "Adding…" : "Add NGO"}
        </button>
      </div>
      <Result state={state} />
    </form>
  );
}
