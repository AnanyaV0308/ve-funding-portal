"use client";

import { useRouter } from "next/navigation";
import { useActionState, useRef, useState } from "react";
import { describedBy, Field, inputClass } from "@/components/field";
import { addPlanLink, addReportLink, recordPlanUpload, recordReportUpload, type ReportFormState, startPlanUpload, startReportUpload } from "../report-actions";

/** The two kinds of company document people can add by hand: its annual report and its CSR action plan. */
const KINDS = {
  report: {
    addLink: addReportLink,
    startUpload: startReportUpload,
    recordUpload: recordReportUpload,
    linkLabel: "Link to the report's PDF",
    linkHint: "From the company's own website, such as its investor relations page.",
    fileHint: "Up to 50 MB, for example one downloaded from NSE or BSE.",
    choose: "Choose the annual report's PDF.",
    uploadName: "Upload the annual report",
  },
  plan: {
    addLink: addPlanLink,
    startUpload: startPlanUpload,
    recordUpload: recordPlanUpload,
    linkLabel: "Link to the plan",
    linkHint: "A PDF or web page on the company's own website, often under CSR or investors.",
    fileHint: "Up to 50 MB, for example a plan saved from a page the portal couldn't read.",
    choose: "Choose the action plan's PDF.",
    uploadName: "Upload the CSR action plan",
  },
};
export type DocKind = keyof typeof KINDS;

function Message({ state, id }: { state: { ok: boolean; message: string } | null; id: string }) {
  return (
    <p id={id} role="status" aria-live="polite" className={state ? `rounded-md p-3 ${state.ok ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad"}` : "sr-only"}>
      {state?.message ?? ""}
    </p>
  );
}

/** Gives the portal a document's link, such as one on the company's investor page. */
export function ReportLinkForm({ funderId, kind = "report" }: { funderId: string; kind?: DocKind }) {
  const k = KINDS[kind];
  const [state, action, pending] = useActionState<ReportFormState, FormData>(k.addLink, null);
  const id = `${kind}-url`;
  return (
    <form action={action} className="grid gap-3" noValidate>
      <input type="hidden" name="funderId" value={funderId} />
      <Field id={id} label={k.linkLabel} hint={k.linkHint}>
        <input
          id={id}
          name="url"
          type="url"
          inputMode="url"
          placeholder="https://"
          key={state?.ok ? "done" : "editing"}
          defaultValue={state?.values?.url ?? ""}
          className={inputClass}
          aria-invalid={state ? !state.ok : undefined}
          aria-describedby={`${describedBy(id, { hint: true })} ${id}-status`}
        />
      </Field>
      <div>
        <button type="submit" className="btn btn-secondary" disabled={pending}>
          {pending ? "Adding…" : "Add the link"}
        </button>
      </div>
      <Message state={state} id={`${id}-status`} />
    </form>
  );
}

/** Uploads a document's PDF straight to storage through a signed link, then queues it to be read. */
export function ReportUploadForm({ funderId, kind = "report" }: { funderId: string; kind?: DocKind }) {
  const k = KINDS[kind];
  const id = `${kind}-file`;
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const file = new FormData(e.currentTarget).get("file");
    if (!(file instanceof File) || file.size === 0) {
      setResult({ ok: false, message: k.choose });
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const start = await k.startUpload({ funderId, fileName: file.name, size: file.size });
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
      const recorded = await k.recordUpload({ funderId, key: start.key, fileName: file.name });
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
    <form ref={form} onSubmit={onSubmit} className="grid gap-3" aria-label={k.uploadName}>
      <Field id={id} label="Or upload the PDF" hint={k.fileHint}>
        <input
          id={id}
          name="file"
          type="file"
          accept=".pdf,application/pdf"
          aria-describedby={`${describedBy(id, { hint: true })} ${id}-status`}
          className="text-sm file:mr-3 file:rounded-md file:border file:border-ve-line file:bg-ve-cream file:px-3 file:py-2 file:text-ve-charcoal"
        />
      </Field>
      <div>
        <button type="submit" className="btn btn-secondary" disabled={busy}>
          {busy ? "Uploading…" : "Upload"}
        </button>
      </div>
      <Message state={result} id={`${id}-status`} />
    </form>
  );
}
