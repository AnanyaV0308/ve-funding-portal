"use client";

import { formatInrShort } from "@ve/core";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { describedBy, Field, inputClass } from "@/components/field";
import { checkDonorList, type DonorFormState } from "./actions";

const NEW_TYPE_LABELS = {
  company: { option: "Companies (CSR)", noun: "company", one: "a company", plural: "companies" },
  foundation: { option: "Foundations or trusts", noun: "foundation", one: "a foundation", plural: "foundations" },
  hni: { option: "Individuals (HNIs)", noun: "individual", one: "an individual", plural: "individuals" },
} as const;

/** Paste a peer NGO's donors, check how they match the portal, then save. */
export function DonorListForm({ peers }: { peers: string[] }) {
  const [state, action, pending] = useActionState<DonorFormState, FormData>(checkDonorList, null);
  const err = state?.fieldErrors ?? {};
  const v = (key: string) => state?.values?.[key] ?? "";
  const [ngo, setNgo] = useState("");
  const previewHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (state?.values) setNgo(state.values.ngo ?? "");
    // Move to the matches so a screen reader reads them straight after "Check the list".
    if (state?.preview) previewHeading.current?.focus();
  }, [state]);

  const preview = state?.preview;
  const type = (v("newFunderType") || "company") as keyof typeof NEW_TYPE_LABELS;
  const matched = preview?.rows.filter((r) => r.match !== "new").length ?? 0;
  const fresh = (preview?.rows.length ?? 0) - matched;

  const text = (id: string, label: string, opts: { hint?: string; type?: string; inputMode?: "url" } = {}) => (
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
    <form action={action} className="grid max-w-3xl gap-5" noValidate>
      <input type="hidden" name="checked" value={preview?.checked ?? ""} />
      {state && !state.ok ? (
        <p role="alert" className="rounded-md bg-bad-soft p-3 text-bad">
          {state.message}
        </p>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="ngo" label="Whose donors are these?" hint="NGOs on VE's peer list raise a company's fit score." error={err.ngo}>
          <select
            key={`ngo-${v("ngo")}`}
            id="ngo"
            name="ngo"
            defaultValue={v("ngo")}
            onChange={(e) => setNgo(e.target.value)}
            className={inputClass}
            aria-invalid={Boolean(err.ngo)}
            aria-describedby={describedBy("ngo", { hint: true, error: err.ngo })}
          >
            <option value="">Choose an NGO</option>
            {peers.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
            <option value="__other">Another NGO…</option>
          </select>
        </Field>
        {ngo === "__other" ? text("ngoOther", "NGO's name") : null}
      </div>

      <div className="grid gap-5 sm:grid-cols-[1fr_2fr]">
        {text("fy", "Financial year (optional)", { hint: "e.g. 2024-25" })}
        {text("sourceLabel", "Where the list comes from", { hint: "e.g. “Saksham annual report 2024-25”" })}
      </div>
      {text("sourceUrl", "Link to it (optional)", { type: "url", inputMode: "url" })}

      <fieldset className="grid gap-2">
        <legend className="font-medium">Add donors the portal doesn&apos;t know yet as</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {Object.entries(NEW_TYPE_LABELS).map(([value, l]) => (
            <label key={`${value}-${v("newFunderType")}`} className="flex items-center gap-2">
              <input type="radio" name="newFunderType" value={value} defaultChecked={value === type} className="accent-ve-olive" />
              {l.option}
            </label>
          ))}
        </div>
        <p className="text-sm text-ve-muted">If a list mixes companies and foundations, add it in two parts.</p>
      </fieldset>

      <Field
        id="donors"
        label="Donors, one per line"
        hint="Copy them as the report writes them. You can add an amount after a comma (Tata Steel Ltd, 25 lakh) and a CIN anywhere on the line."
        error={err.donors}
      >
        <textarea
          id="donors"
          name="donors"
          rows={10}
          defaultValue={v("donors")}
          className={`${inputClass} font-mono text-sm`}
          aria-invalid={Boolean(err.donors)}
          aria-describedby={describedBy("donors", { hint: true, error: err.donors })}
        />
      </Field>

      <div>
        <button type="submit" name="intent" value="check" className={`btn ${preview ? "btn-secondary" : "btn-primary"}`} disabled={pending}>
          {pending ? "Checking…" : preview ? "Check again" : "Check the list"}
        </button>
      </div>

      {preview ? (
        <section aria-labelledby="preview-heading" className="grid gap-3 rounded-lg border border-ve-line bg-ve-paper p-4">
          <h3 id="preview-heading" ref={previewHeading} tabIndex={-1} className="text-lg font-bold">
            {preview.rows.length} {preview.rows.length === 1 ? "donor" : "donors"} of {preview.ngoName}
          </h3>
          <p>
            {matched} already in the portal
            {fresh
              ? `, ${fresh} new: ${fresh === 1 ? `it'll be added as ${NEW_TYPE_LABELS[type].one}` : `they'll be added as ${NEW_TYPE_LABELS[type].plural}`}${
                  type === "company" ? " and marked Needs check" : ""
                }`
              : ""}
            .
          </p>
          {!preview.onPeerList ? (
            <p className="rounded-md bg-warn-soft p-3 text-warn">
              {preview.ngoName} isn&apos;t on VE&apos;s peer list, so this list won&apos;t change any fit scores until an admin adds it in Settings.
            </p>
          ) : null}
          {/* Focusable so keyboard users can scroll a long list. */}
          <div tabIndex={0} role="region" aria-label="Donor matches" className="relative max-h-[28rem] overflow-auto rounded-md border border-ve-line bg-white">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <caption className="sr-only">How each donor matches the portal</caption>
              <thead>
                <tr className="border-b border-ve-line bg-ve-cream">
                  <th scope="col" className="label px-3 py-2 text-xs text-ve-muted">
                    Line
                  </th>
                  <th scope="col" className="label px-3 py-2 text-xs text-ve-muted">
                    Donor as written
                  </th>
                  <th scope="col" className="label px-3 py-2 text-xs text-ve-muted">
                    In the portal
                  </th>
                  <th scope="col" className="label px-3 py-2 text-right text-xs text-ve-muted">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.line} className="border-t border-ve-line align-top">
                    <td className="px-3 py-2 text-ve-muted">{r.line}</td>
                    <th scope="row" className="px-3 py-2 font-normal">
                      {r.name}
                    </th>
                    <td className="px-3 py-2">
                      {r.funder ? (
                        <>
                          <Link href={`/funders/${r.funder.id}`} target="_blank">
                            {r.funder.name}
                            <span className="sr-only"> (opens in a new tab)</span>
                          </Link>
                          {r.match === "cin" ? <span className="block text-xs text-ve-muted">Matched on CIN</span> : null}
                        </>
                      ) : (
                        <span className="font-medium text-ve-olive">New {NEW_TYPE_LABELS[type].noun}</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">{formatInrShort(r.amount) || "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.problems.length ? (
            <div>
              <h4 className="font-medium">Lines left out ({preview.problems.length})</h4>
              <ul className="list-disc pl-5 text-sm">
                {preview.problems.map((p) => (
                  <li key={p.line}>
                    Line {p.line}, “{p.text}”: {p.reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="text-sm text-ve-muted">A name that should have matched a company already in the portal? Fix its spelling above and check again.</p>
          <div>
            <button type="submit" name="intent" value="save" className="btn btn-primary" disabled={pending}>
              {pending ? "Saving…" : `Save ${preview.rows.length} ${preview.rows.length === 1 ? "donor" : "donors"}`}
            </button>
          </div>
        </section>
      ) : null}
      <p role="status" className="sr-only">
        {state?.ok ? state.message : ""}
      </p>
    </form>
  );
}
