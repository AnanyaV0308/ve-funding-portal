"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { describedBy, Field, inputClass } from "@/components/field";
import { queueCsrImport, startCsrUpload } from "../actions";

const UNITS = [
  { value: "auto", label: "Work it out from the column headings" },
  { value: "crore", label: "Crore" },
  { value: "lakh", label: "Lakh" },
  { value: "rupees", label: "Rupees" },
] as const;

/** Uploads a CSV straight to storage through a signed link, then queues it for the worker. */
export function ImportForm() {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const file = data.get("file");
    if (!(file instanceof File) || file.size === 0) {
      setResult({ ok: false, message: "Choose a CSV file." });
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const start = await startCsrUpload({ fileName: file.name, size: file.size });
      if (!("key" in start)) {
        setResult(start);
        return;
      }
      const put = await fetch(start.uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": "text/csv" } });
      if (!put.ok) {
        const body = (await put.json().catch(() => null)) as { error?: string } | null;
        setResult({ ok: false, message: body?.error ?? "The upload failed. Try again." });
        return;
      }
      const queued = await queueCsrImport({ key: start.key, fileName: file.name, unit: String(data.get("unit")) as "auto" });
      setResult(queued);
      if (queued.ok) {
        form.current?.reset();
        router.refresh();
      }
    } catch {
      setResult({ ok: false, message: "The upload failed. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form ref={form} onSubmit={onSubmit} className="grid max-w-2xl gap-4" aria-label="Import CSR data">
      <Field id="file" label="CSV file" hint="Up to 50 MB. One row per project, or per company, year and sector.">
        <input
          id="file"
          name="file"
          type="file"
          accept=".csv,text/csv"
          required
          aria-describedby={describedBy("file", { hint: true })}
          className="text-sm file:mr-3 file:rounded-md file:border file:border-ve-line file:bg-ve-cream file:px-3 file:py-2 file:text-ve-charcoal"
        />
      </Field>
      <Field id="unit" label="Amounts are in" hint="The portal shows amounts in crore and says so in the heading.">
        <select id="unit" name="unit" defaultValue="auto" className={`${inputClass} sm:max-w-sm`} aria-describedby={describedBy("unit", { hint: true })}>
          {UNITS.map((u) => (
            <option key={u.value} value={u.value}>
              {u.label}
            </option>
          ))}
        </select>
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Uploading…" : "Upload and import"}
        </button>
      </div>
      <p role="status" aria-live="polite" className={result ? `rounded-md p-3 ${result.ok ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad"}` : "sr-only"}>
        {result?.message ?? ""}
      </p>
    </form>
  );
}
