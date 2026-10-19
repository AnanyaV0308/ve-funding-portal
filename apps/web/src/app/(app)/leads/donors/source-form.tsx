"use client";

import { useActionState } from "react";
import { inputClass } from "@/components/field";
import { saveSource, type SourceFormState } from "./report-actions";

/** The link to one peer NGO's reports page, editable in place. */
export function SourceForm({ ngo, url }: { ngo: string; url: string | null }) {
  const [state, action, pending] = useActionState<SourceFormState, FormData>(saveSource, null);
  const id = `source-${ngo.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <form action={action} className="grid gap-1" noValidate>
      <input type="hidden" name="ngo" value={ngo} />
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={id} className="sr-only">
          {ngo}&apos;s reports page
        </label>
        <input
          id={id}
          name="url"
          type="url"
          inputMode="url"
          defaultValue={state?.values?.url ?? url ?? ""}
          placeholder="https://"
          className={`${inputClass} min-w-0 flex-1 text-sm`}
          aria-invalid={state ? !state.ok : undefined}
          aria-describedby={`${id}-status`}
        />
        <button type="submit" className="btn btn-secondary px-3 py-1 text-xs" disabled={pending} aria-label={`Save ${ngo}'s reports page`}>
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      <p id={`${id}-status`} role="status" className={`text-sm ${state?.ok ? "text-ok" : "text-bad"}`}>
        {state?.message}
      </p>
    </form>
  );
}
