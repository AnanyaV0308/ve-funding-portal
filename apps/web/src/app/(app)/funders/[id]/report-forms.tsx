"use client";

import { useRouter } from "next/navigation";
import { useActionState, useRef, useState } from "react";
import { describedBy, Field, inputClass } from "@/components/field";
import { addReportLink, recordReportUpload, type ReportFormState, startReportUpload } from "../report-actions";

function Message({ state, id }: { state: { ok: boolean; message: string } | null; id: string }) {
  return (
    <p id={id} role="status" aria-live="polite" className={state ? `rounded-md p-3 ${state.ok ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad"}` : "sr-only"}>
      {state?.message ?? ""}
    </p>
  );
}

/** Gives the portal a report's link, such as one on the company's investor page. */
export function ReportLinkForm({ funderId }: { funderId: string }) {
  const [state, action, pending] = useActionState<ReportFormState, FormData>(addReportLink, null);
  return (
    <form action={action} className="grid gap-3" noValidate>
      <input type="hidden" name="funderId" value={funderId} />
      <Field id="report-url" label="Link to the report's PDF" hint="From the company's own website, such as its investor relations page.">
        <input
          id="report-url"
          name="url"
          type="url"
          inputMode="url"
          placeholder="https://"
          key={state?.ok ? "done" : "editing"}
          defaultValue={state?.values?.url ?? ""}
          className={inputClass}
          aria-invalid={state ? !state.ok : undefined}
          aria-describedby={`${describedBy("report-url", { hint: true })} report-url-status`}
        />
      </Field>
      <div>
        <button type="submit" className="btn btn-secondary" disabled={pending}>
          {pending ? "Adding…" : "Add the link"}
        </button>
      </div>
      <Message state={state} id="report-url-status" />
    </form>
  );
}

/** Uploads a report's PDF straight to storage through a signed link, then queues it to be read. */
export function ReportUploadForm({ funderId }: { funderId: string }) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const file = new FormData(e.currentTarget).get("file");
    if (!(file instanceof File) || file.size === 0) {
      setResult({ ok: false, message: "Choose the annual report's PDF." });
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const start = await startReportUpload({ funderId, fileName: file.name, size: file.size });
      if (!start.ok) {
        setResult(start);
        return;
      }
      const put = await fetch(start.uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": "application/pdf" } });
      if (!put.ok) {
        const body = (await put.json().catch(() => null)) as { error?: string } | null;
        setResult({ ok: false, message: body?.error ?? "The upload failed. Try again." });
        return;
      }
      const recorded = await recordReportUpload({ funderId, key: start.key, fileName: file.name });
      setResult(recorded);
      if (recorded.ok) {
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
    <form ref={form} onSubmit={onSubmit} className="grid gap-3" aria-label="Upload the annual report">
      <Field id="report-file" label="Or upload the PDF" hint="Up to 50 MB, for example one downloaded from NSE or BSE.">
        <input
          id="report-file"
          name="file"
          type="file"
          accept=".pdf,application/pdf"
          aria-describedby={`${describedBy("report-file", { hint: true })} report-file-status`}
          className="text-sm file:mr-3 file:rounded-md file:border file:border-ve-line file:bg-ve-cream file:px-3 file:py-2 file:text-ve-charcoal"
        />
      </Field>
      <div>
        <button type="submit" className="btn btn-secondary" disabled={busy}>
          {busy ? "Uploading…" : "Upload"}
        </button>
      </div>
      <Message state={result} id="report-file-status" />
    </form>
  );
}
