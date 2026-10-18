"use client";

import { ACTIVITY_KIND_LABELS, ACTIVITY_KINDS, formatInr, type Stage, stageLabel } from "@ve/core";
import { useActionState, useEffect, useRef } from "react";
import { describedBy, Field, inputClass } from "@/components/field";
import { addActivity, type FormState, movePursuit, updatePursuit } from "../../pipeline/actions";

type Option = { id: string; name: string };

/** A live region that is always in the page, so screen readers announce what the form did. */
function Result({ state }: { state: FormState }) {
  return (
    <p role="status" className={state?.ok ? "rounded-md bg-ok-soft p-3 text-ok" : "sr-only"}>
      {state?.ok ? state.message : ""}
    </p>
  );
}

function ErrorSummary({ state }: { state: FormState }) {
  return state && !state.ok ? (
    <p role="alert" className="rounded-md bg-bad-soft p-3 text-bad">
      {state.message}
    </p>
  ) : null;
}

export type DetailsValues = {
  id: string;
  title: string;
  ownerId: string | null;
  askAmount: number | null;
  probabilityOverride: number | null;
  defaultProbability: number;
  nextAction: string | null;
  nextActionDue: string | null;
};

export function DetailsForm({ values, people }: { values: DetailsValues; people: Option[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(updatePursuit, null);
  const err = state?.fieldErrors ?? {};
  const v = (key: string, fallback: string | number | null) =>
    state && !state.ok && state.values?.[key] !== undefined ? state.values[key]! : fallback === null ? "" : String(fallback);

  return (
    <form action={action} className="grid gap-4" noValidate>
      <input type="hidden" name="id" value={values.id} />
      <ErrorSummary state={state} />
      <Field id="title" label="What VE is asking for" error={err.title}>
        <input id="title" name="title" defaultValue={v("title", values.title)} className={inputClass} aria-invalid={Boolean(err.title)} aria-describedby={describedBy("title", { error: err.title })} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="ownerId" label="Owner">
          <select key={`ownerId-${v("ownerId", values.ownerId)}`} id="ownerId" name="ownerId" defaultValue={v("ownerId", values.ownerId)} className={inputClass}>
            <option value="">No owner yet</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id="askAmount" label="Ask" hint="40 lakh, 1.5 crore or 4000000." error={err.askAmount}>
          <input
            id="askAmount"
            name="askAmount"
            defaultValue={v("askAmount", values.askAmount === null ? null : formatInr(values.askAmount))}
            inputMode="decimal"
            className={inputClass}
            aria-invalid={Boolean(err.askAmount)}
            aria-describedby={describedBy("askAmount", { hint: true, error: err.askAmount })}
          />
        </Field>
      </div>
      <Field
        id="probabilityOverride"
        label="Chance of winning, % (optional)"
        hint={`Leave empty to use the stage's ${values.defaultProbability}%. A value you set is cleared when the stage changes.`}
        error={err.probabilityOverride}
      >
        <input
          id="probabilityOverride"
          name="probabilityOverride"
          type="number"
          min={0}
          max={100}
          defaultValue={v("probabilityOverride", values.probabilityOverride)}
          className={`${inputClass} sm:max-w-40`}
          aria-invalid={Boolean(err.probabilityOverride)}
          aria-describedby={describedBy("probabilityOverride", { hint: true, error: err.probabilityOverride })}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
        <Field id="nextAction" label="Next action" error={err.nextAction}>
          <input id="nextAction" name="nextAction" defaultValue={v("nextAction", values.nextAction)} className={inputClass} />
        </Field>
        <Field id="nextActionDue" label="Due" error={err.nextActionDue}>
          <input id="nextActionDue" name="nextActionDue" type="date" defaultValue={v("nextActionDue", values.nextActionDue)} className={inputClass} aria-describedby={describedBy("nextActionDue", { error: err.nextActionDue })} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Saving…" : "Save details"}
        </button>
      </div>
      <Result state={state} />
    </form>
  );
}

export function ActivityForm({ pursuitId, today }: { pursuitId: string; today: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(addActivity, null);
  const err = state?.fieldErrors ?? {};
  const v = (key: string, fallback: string) => (state && !state.ok ? (state.values?.[key] ?? fallback) : fallback);
  return (
    <form action={action} className="grid gap-4" noValidate>
      <input type="hidden" name="pursuitId" value={pursuitId} />
      <ErrorSummary state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="kind" label="What kind">
          <select key={`kind-${v("kind", "note")}`} id="kind" name="kind" defaultValue={v("kind", "note")} className={inputClass}>
            {ACTIVITY_KINDS.map((k) => (
              <option key={k} value={k}>
                {ACTIVITY_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field id="occurredOn" label="When" error={err.occurredOn}>
          <input id="occurredOn" name="occurredOn" type="date" defaultValue={v("occurredOn", today)} className={inputClass} aria-describedby={describedBy("occurredOn", { error: err.occurredOn })} />
        </Field>
      </div>
      <Field id="summary" label="What happened" hint="Who you spoke to, what was agreed, what they asked for." error={err.summary}>
        <textarea
          id="summary"
          name="summary"
          rows={3}
          defaultValue={v("summary", "")}
          className={inputClass}
          aria-invalid={Boolean(err.summary)}
          aria-describedby={describedBy("summary", { hint: true, error: err.summary })}
        />
      </Field>
      <div>
        <button type="submit" className="btn btn-secondary" disabled={pending}>
          {pending ? "Logging…" : "Log it"}
        </button>
      </div>
      <Result state={state} />
    </form>
  );
}

/** Shown when someone moves a pursuit to "Not now or lost" or "Not selected": the reason is required. */
export function CloseForm({ pursuitId, stage, cancelHref }: { pursuitId: string; stage: Stage; cancelHref: string }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <section aria-labelledby="close-heading" className="grid gap-4 rounded-lg border-2 border-ve-olive bg-white p-5">
      <h2 id="close-heading" ref={heading} tabIndex={-1} className="text-xl font-bold">
        Move to “{stageLabel(stage)}”
      </h2>
      <p className="text-ve-muted">Say why, so whoever picks this up later knows what happened. Add a date if it's worth trying again.</p>
      <form action={movePursuit} className="grid gap-4">
        <input type="hidden" name="id" value={pursuitId} />
        <input type="hidden" name="stage" value={stage} />
        <Field id="closedReason" label="Reason">
          <textarea id="closedReason" name="closedReason" rows={3} required className={inputClass} />
        </Field>
        <Field id="revisitOn" label="Try again from (optional)">
          <input id="revisitOn" name="revisitOn" type="date" className={`${inputClass} sm:max-w-56`} />
        </Field>
        <div className="flex flex-wrap gap-3">
          <button type="submit" className="btn btn-primary">
            Move to {stageLabel(stage)}
          </button>
          <a href={cancelHref} className="btn btn-secondary no-underline">
            Cancel
          </a>
        </div>
      </form>
    </section>
  );
}
