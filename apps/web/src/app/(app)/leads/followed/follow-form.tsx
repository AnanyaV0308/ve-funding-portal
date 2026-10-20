"use client";

import { MAX_COMPANIES_FOLLOWED } from "@ve/core";
import { useActionState } from "react";
import { describedBy, Field, inputClass } from "@/components/field";
import { type FollowFormState, saveFollowed } from "../../funders/report-actions";

/** How many of the best-fitting companies the portal follows. */
export function FollowForm({ count }: { count: number }) {
  const [state, action, pending] = useActionState<FollowFormState, FormData>(saveFollowed, null);
  return (
    <form action={action} className="grid gap-3" noValidate>
      <Field
        id="follow-count"
        label="Companies to follow"
        hint={`The best-fitting companies, up to ${MAX_COMPANIES_FOLLOWED}. Finding and reading a company's CSR action plan costs an estimated ₹30 to ₹60 a year, and a listed company's annual report another ₹20 to ₹50. A company that never puts its plan online can cost up to about ₹250 a year in searches. 0 stops the portal looking on its own.`}
      >
        <input
          id="follow-count"
          name="count"
          type="number"
          inputMode="numeric"
          min={0}
          max={MAX_COMPANIES_FOLLOWED}
          defaultValue={state?.value ?? String(count)}
          className={`${inputClass} sm:max-w-[10rem]`}
          aria-invalid={state ? !state.ok : undefined}
          aria-describedby={`${describedBy("follow-count", { hint: true })} follow-count-status`}
        />
      </Field>
      <div>
        <button type="submit" className="btn btn-secondary" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      <p id="follow-count-status" role="status" className={state ? `rounded-md p-3 ${state.ok ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad"}` : "sr-only"}>
        {state?.message ?? ""}
      </p>
    </form>
  );
}
