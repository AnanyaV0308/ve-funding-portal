"use client";

import { DOCUMENT_KIND_LABELS, DOCUMENT_KINDS } from "@ve/core";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { saveDocument, startUpload } from "../actions";

const input = "w-full rounded-md border border-ve-line bg-white px-3 py-2";
const ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.pptx,.png,.jpg,.jpeg,.txt,.csv";

function titleFromFile(name: string) {
  return name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
}

/**
 * Adds a new document, or a new version of an existing one when `documentId` is given.
 * The file goes straight to storage through a signed link; only the record goes through the server.
 */
export function UploadForm({ documentId, documentTitle }: { documentId?: string; documentTitle?: string }) {
  const router = useRouter();
  const uid = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const isVersion = Boolean(documentId);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      setResult({ ok: false, message: "Choose a file to upload." });
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const start = await startUpload({ fileName: file.name, contentType: file.type, size: file.size });
      if (!start.ok) {
        setResult(start);
        return;
      }
      const put = await fetch(start.uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      if (!put.ok) {
        const body = (await put.json().catch(() => null)) as { error?: string } | null;
        setResult({ ok: false, message: body?.error ?? "The upload failed. Try again." });
        return;
      }
      const saved = await saveDocument({
        documentId: documentId ?? "",
        key: start.key,
        fileName: file.name,
        contentType: file.type,
        title: String(form.get("title") ?? ""),
        kind: String(form.get("kind") ?? ""),
        period: String(form.get("period") ?? ""),
        notes: String(form.get("notes") ?? ""),
      });
      setResult(saved);
      if (saved.ok) {
        formRef.current?.reset();
        setTitle("");
        router.refresh();
      }
    } catch {
      setResult({ ok: false, message: "The upload failed. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="grid gap-4" aria-label={isVersion ? `Upload a new version of ${documentTitle}` : "Add a document"}>
      <div className="grid gap-1">
        <label htmlFor={`${uid}-file`} className="font-medium">
          {isVersion ? "New version" : "File"}
        </label>
        <p id={`${uid}-file-hint`} className="text-sm text-ve-muted">
          PDF, Word, Excel, PowerPoint, image, text or CSV, up to 50 MB.
        </p>
        <input
          id={`${uid}-file`}
          name="file"
          type="file"
          accept={ACCEPT}
          required
          aria-describedby={`${uid}-file-hint`}
          className="text-sm file:mr-3 file:rounded-md file:border file:border-ve-line file:bg-ve-cream file:px-3 file:py-2 file:text-ve-charcoal"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f && !isVersion && !title) setTitle(titleFromFile(f.name));
          }}
        />
      </div>

      {isVersion ? null : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1">
              <label htmlFor={`${uid}-title`} className="font-medium">
                Title
              </label>
              <input id={`${uid}-title`} name="title" value={title} onChange={(e) => setTitle(e.target.value)} required className={input} />
            </div>
            <div className="grid gap-1">
              <label htmlFor={`${uid}-kind`} className="font-medium">
                Type
              </label>
              <select id={`${uid}-kind`} name="kind" required defaultValue="" className={input}>
                <option value="" disabled>
                  Choose a type
                </option>
                {DOCUMENT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {DOCUMENT_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1">
              <label htmlFor={`${uid}-period`} className="font-medium">
                Year or period (optional)
              </label>
              <input id={`${uid}-period`} name="period" placeholder="e.g. 2025-26" className={input} />
            </div>
            <div className="grid gap-1">
              <label htmlFor={`${uid}-notes`} className="font-medium">
                Notes (optional)
              </label>
              <input id={`${uid}-notes`} name="notes" placeholder="e.g. Signed MoU with Wipro Foundation" className={input} />
            </div>
          </div>
        </>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Uploading…" : isVersion ? "Upload new version" : "Upload document"}
        </button>
        <p role="status" aria-live="polite" className={`text-sm ${result?.ok ? "text-ok" : "text-bad"}`}>
          {result?.message}
        </p>
      </div>
    </form>
  );
}
