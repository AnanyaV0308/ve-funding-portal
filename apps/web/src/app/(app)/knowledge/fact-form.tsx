"use client";

import {
  CONSENT_STATUSES,
  KNOWLEDGE_CATEGORIES,
  KNOWLEDGE_CATEGORY_LABELS,
  type KnowledgeCategory,
} from "@ve/core";
import { useActionState, useEffect, useState } from "react";
import { Field, inputClass } from "@/components/field";
import { type FormState, saveFact } from "./actions";

export type FactFormValues = {
  id?: string;
  category: KnowledgeCategory;
  title: string;
  body: string;
  asOf: string | null;
  sourceLabel: string | null;
  sourceUrl: string | null;
  consent: string | null;
  ownerId: string | null;
  refreshMonths: number;
};

const CONSENT_LABELS: Record<(typeof CONSENT_STATUSES)[number], string> = {
  given: "Consent given",
  pending: "Consent pending",
  not_given: "No consent: don't use",
};

const input = inputClass;

export function FactForm({ values, people }: { values: FactFormValues; people: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveFact, null);
  const [category, setCategory] = useState<KnowledgeCategory>(values.category);
  const [refresh, setRefresh] = useState(String(values.refreshMonths));
  const err = state?.fieldErrors ?? {};
  // React resets a form after its action runs; after a validation error, refill it with what was typed.
  const v = (key: string, fallback: string | number | null) => state?.values?.[key] ?? (fallback === null ? "" : String(fallback));
  useEffect(() => {
    if (state?.values?.category) setCategory(state.values.category as KnowledgeCategory);
    if (state?.values?.refreshMonths) setRefresh(state.values.refreshMonths);
  }, [state]);
  const describe = (id: string, hint?: boolean) =>
    [hint ? `${id}-hint` : null, err[id] ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;

  return (
    <form action={action} className="grid max-w-2xl gap-5" noValidate>
      {values.id ? <input type="hidden" name="id" value={values.id} /> : null}

      {state && !state.ok ? (
        <p role="alert" className="rounded-md bg-bad-soft p-3 text-bad">
          {state.message}
        </p>
      ) : null}

      <Field id="category" label="Category" error={err.category}>
        <select
          key={`category-${v("category", values.category)}`}
          id="category"
          name="category"
          className={input}
          defaultValue={v("category", values.category)}
          aria-describedby={describe("category")}
          onChange={(e) => {
            const next = e.target.value as KnowledgeCategory;
            setCategory(next);
            if (!values.id) setRefresh(String(KNOWLEDGE_CATEGORY_LABELS[next].refreshMonths));
          }}
        >
          {KNOWLEDGE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {KNOWLEDGE_CATEGORY_LABELS[c].name}
            </option>
          ))}
        </select>
      </Field>

      <Field id="title" label="Name" hint="Short and specific, e.g. “Students reached, FY 2025-26”." error={err.title}>
        <input id="title" name="title" defaultValue={v("title", values.title)} className={input} required aria-invalid={Boolean(err.title)} aria-describedby={describe("title", true)} />
      </Field>

      <Field id="body" label="Fact" hint="The number, text or answer exactly as it should appear in a proposal." error={err.body}>
        <textarea id="body" name="body" defaultValue={v("body", values.body)} rows={category === "answer" || category === "story" ? 8 : 3} className={input} required aria-invalid={Boolean(err.body)} aria-describedby={describe("body", true)} />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="asOf" label="As of (optional)" hint="The date this describes, e.g. 31 March for a financial year." error={err.asOf}>
          <input id="asOf" name="asOf" type="date" defaultValue={v("asOf", values.asOf)} className={input} aria-describedby={describe("asOf", true)} />
        </Field>
        <Field id="refreshMonths" label="Check again every (months)" hint="It's flagged for review when this time has passed." error={err.refreshMonths}>
          <input id="refreshMonths" name="refreshMonths" type="number" min={1} max={60} value={refresh} onChange={(e) => setRefresh(e.target.value)} className={input} aria-describedby={describe("refreshMonths", true)} />
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="sourceLabel" label="Source (optional)" hint="e.g. Annual report 2025-26" error={err.sourceLabel}>
          <input id="sourceLabel" name="sourceLabel" defaultValue={v("sourceLabel", values.sourceLabel)} className={input} aria-describedby={describe("sourceLabel", true)} />
        </Field>
        <Field id="sourceUrl" label="Source link (optional)" error={err.sourceUrl}>
          <input id="sourceUrl" name="sourceUrl" type="url" inputMode="url" defaultValue={v("sourceUrl", values.sourceUrl)} className={input} aria-invalid={Boolean(err.sourceUrl)} aria-describedby={describe("sourceUrl")} />
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="ownerId" label="Owner (optional)" hint="Who keeps this up to date." error={err.ownerId}>
          <select key={`ownerId-${v("ownerId", values.ownerId)}`} id="ownerId" name="ownerId" defaultValue={v("ownerId", values.ownerId)} className={input} aria-describedby={describe("ownerId", true)}>
            <option value="">No owner yet</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        {category === "story" ? (
          <Field id="consent" label="Consent" hint="Stories are only used with consent." error={err.consent}>
            <select key={`consent-${v("consent", values.consent ?? "pending")}`} id="consent" name="consent" defaultValue={v("consent", values.consent ?? "pending")} className={input} aria-describedby={describe("consent", true)}>
              {CONSENT_STATUSES.map((c) => (
                <option key={c} value={c}>
                  {CONSENT_LABELS[c]}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Saving…" : values.id ? "Save and mark as checked" : "Add fact"}
        </button>
        <a href="/knowledge" className="btn btn-secondary no-underline">
          Cancel
        </a>
      </div>
    </form>
  );
}
