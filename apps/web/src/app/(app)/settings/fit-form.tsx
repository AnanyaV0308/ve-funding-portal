"use client";

import { FIT_PART_LABELS, FIT_PARTS, type FitSettings, formatInrShort, INDIAN_STATES } from "@ve/core";
import { useActionState, useState } from "react";
import { inputClass } from "@/components/field";
import { type FitFormState, saveFitSettingsAction } from "./fit-actions";

export function FitForm({ settings }: { settings: FitSettings }) {
  const [state, action, pending] = useActionState<FitFormState, FormData>(saveFitSettingsAction, null);
  const [weights, setWeights] = useState(settings.weights);
  const total = FIT_PARTS.reduce((a, p) => a + (Number(weights[p]) || 0), 0);

  return (
    <form action={action} className="grid gap-6">
      {state && !state.ok ? (
        <div role="alert" className="rounded-md bg-bad-soft p-3 text-bad">
          <p>{state.message}</p>
          {state.problems?.length ? (
            <ul className="mt-1 list-disc pl-5">
              {state.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <fieldset className="grid gap-3">
        <legend className="font-bold">Weights</legend>
        <p className="text-sm text-ve-muted" id="weights-hint">
          How many of the 100 points each part is worth. They must add up to 100.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FIT_PARTS.map((p) => (
            <div key={p} className="grid content-start gap-1">
              <label htmlFor={`weight-${p}`} className="font-medium">
                {FIT_PART_LABELS[p].name}
              </label>
              <p id={`weight-${p}-hint`} className="text-sm text-ve-muted">
                {FIT_PART_LABELS[p].description}
              </p>
              <input
                id={`weight-${p}`}
                name={`weight-${p}`}
                type="number"
                min={0}
                max={100}
                step={1}
                value={weights[p]}
                onChange={(e) => setWeights({ ...weights, [p]: Number(e.target.value) })}
                aria-describedby={`weight-${p}-hint weights-hint`}
                className={`${inputClass} sm:max-w-32`}
              />
            </div>
          ))}
        </div>
        <p aria-live="polite" className={total === 100 ? "text-ok" : "font-medium text-bad"}>
          Total: {total} of 100
        </p>
      </fieldset>

      <div className="grid content-start gap-1">
        <label htmlFor="floor" className="font-bold">
          Floor
        </label>
        <p id="floor-hint" className="text-sm text-ve-muted">
          Companies whose total CSR spend is below this are marked not eligible. Now {formatInrShort(settings.floorRupees)}.
        </p>
        <input id="floor" name="floor" defaultValue={`${settings.floorRupees / 100_000} lakh`} aria-describedby="floor-hint" className={`${inputClass} sm:max-w-56`} />
      </div>

      <fieldset className="grid gap-2">
        <legend className="font-bold">States where VE works</legend>
        <p className="text-sm text-ve-muted">Spend in these states counts towards the geography part. Spend marked Pan India counts half.</p>
        <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
          {INDIAN_STATES.map((s) => (
            <label key={s} className="flex items-center gap-2">
              <input type="checkbox" name="veStates" value={s} defaultChecked={settings.veStates.includes(s)} className="size-4 accent-ve-olive" />
              {s}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid content-start gap-1">
        <label htmlFor="peerNgos" className="font-bold">
          Peer NGOs
        </label>
        <p id="peerNgos-hint" className="text-sm text-ve-muted">
          One per line. A company that funds two or more of these gets the full peer score.
        </p>
        <textarea id="peerNgos" name="peerNgos" rows={8} defaultValue={settings.peerNgos.join("\n")} aria-describedby="peerNgos-hint" className={`${inputClass} max-w-xl`} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Saving and rescoring…" : "Save fit settings"}
        </button>
      </div>
      <p role="status" className={state?.ok ? "rounded-md bg-ok-soft p-3 text-ok" : "sr-only"}>
        {state?.ok ? state.message : ""}
      </p>
    </form>
  );
}
