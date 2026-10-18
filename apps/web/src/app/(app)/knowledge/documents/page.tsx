import { can, DOCUMENT_KIND_LABELS } from "@ve/core";
import { db, documents, documentVersions } from "@ve/db";
import { asc, desc } from "drizzle-orm";
import { NoAccess } from "@/components/no-access";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/authz";
import { formatBytes, formatDate } from "@/lib/format";
import { KnowledgeTabs } from "../tabs";
import { UploadForm } from "./upload-form";

export const metadata = { title: "Documents" };

export default async function DocumentsPage() {
  const user = await requireUser();
  if (!can(user.roles, "knowledge:view")) return <NoAccess what="the knowledge base" />;
  const canEdit = can(user.roles, "knowledge:edit");

  const docs = await db.query.documents.findMany({
    orderBy: [asc(documents.kind), asc(documents.title)],
    with: {
      versions: {
        orderBy: desc(documentVersions.version),
        with: { uploader: { columns: { name: true, email: true } } },
      },
    },
  });

  return (
    <>
      <PageHeader
        title="VE knowledge base"
        intro="Annual reports, audited accounts, registrations, past proposals and MoUs. Every upload is kept as a version, so nothing is overwritten."
      />
      <KnowledgeTabs current="documents" />

      {canEdit ? (
        <section aria-labelledby="add-doc" className="grid max-w-3xl gap-3 rounded-lg border border-ve-line bg-white p-5">
          <h2 id="add-doc" className="text-xl font-bold">
            Add a document
          </h2>
          <UploadForm />
        </section>
      ) : null}

      <section aria-labelledby="doc-list" className="grid gap-3">
        <h2 id="doc-list" className="text-xl font-bold">
          Documents ({docs.length})
        </h2>
        {docs.length === 0 ? (
          <p className="max-w-prose rounded-lg border border-dashed border-ve-line bg-white p-6 text-ve-muted">
            No documents yet. Past proposals, MoUs and annual reports uploaded here will feed the drafting assistant in Phase 2.
          </p>
        ) : (
          <ul className="grid gap-3">
            {docs.map((doc) => {
              const [latest, ...older] = doc.versions;
              return (
                <li key={doc.id} className="grid gap-3 rounded-lg border border-ve-line bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-medium">{doc.title}</h3>
                      <p className="text-sm text-ve-muted">
                        {DOCUMENT_KIND_LABELS[doc.kind]}
                        {doc.period ? ` · ${doc.period}` : ""}
                        {doc.notes ? ` · ${doc.notes}` : ""}
                      </p>
                    </div>
                    {latest ? (
                      <a href={`/api/files/${latest.id}`} className="btn btn-secondary text-sm no-underline">
                        Download v{latest.version}
                        <span className="sr-only"> of {doc.title}</span>
                      </a>
                    ) : null}
                  </div>
                  {latest ? (
                    <p className="text-sm">
                      <span className="font-medium">{latest.fileName}</span>
                      <span className="text-ve-muted">
                        {" "}
                        · {formatBytes(latest.sizeBytes)} · uploaded {formatDate(latest.uploadedAt)} by{" "}
                        {latest.uploader?.name ?? latest.uploader?.email ?? "someone"}
                      </span>
                    </p>
                  ) : null}
                  {older.length ? (
                    <details>
                      <summary className="cursor-pointer text-sm text-ve-olive">Earlier versions ({older.length})</summary>
                      <ul className="mt-2 grid gap-1 text-sm">
                        {older.map((v) => (
                          <li key={v.id}>
                            <a href={`/api/files/${v.id}`}>
                              v{v.version}: {v.fileName}
                            </a>
                            <span className="text-ve-muted"> · {formatDate(v.uploadedAt)}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                  {canEdit ? (
                    <details>
                      <summary className="cursor-pointer text-sm text-ve-olive">Upload a new version</summary>
                      <div className="mt-3">
                        <UploadForm documentId={doc.id} documentTitle={doc.title} />
                      </div>
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
