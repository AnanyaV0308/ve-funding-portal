import { can } from "@ve/core";
import { dataImports, db } from "@ve/db";
import { desc } from "drizzle-orm";
import Link from "next/link";
import { NoAccess } from "@/components/no-access";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/authz";
import { formatDate } from "@/lib/format";
import { ImportForm } from "./import-form";

export const metadata = { title: "Import CSR data" };

const STATUS: Record<string, { label: string; style: string }> = {
  queued: { label: "Waiting", style: "bg-ve-cream text-ve-olive" },
  running: { label: "Importing", style: "bg-warn-soft text-warn" },
  done: { label: "Done", style: "bg-ok-soft text-ok" },
  failed: { label: "Failed", style: "bg-bad-soft text-bad" },
};

export default async function ImportPage() {
  const user = await requireUser();
  if (!can(user.roles, "leads:view")) return <NoAccess what="CSR leads" />;
  const canImport = can(user.roles, "leads:edit");
  const imports = await db.query.dataImports.findMany({
    orderBy: desc(dataImports.createdAt),
    limit: 20,
    with: { creator: { columns: { name: true, email: true } } },
  });

  return (
    <>
      <p>
        <Link href="/leads">
          <span aria-hidden="true">← </span>CSR leads
        </Link>
      </p>
      <PageHeader
        title="Import CSR data"
        intro="Load company-wise CSR spend from the National CSR Portal. Each company is matched on its CIN, a year in the file replaces what was stored for that year, and every company is scored again afterwards."
      />

      {canImport ? (
        <section aria-labelledby="how-heading" className="grid gap-4 rounded-lg border border-ve-line bg-white p-5">
          <h2 id="how-heading" className="text-xl font-bold">
            Upload a file
          </h2>
          <ol className="grid max-w-prose list-decimal gap-1 pl-5 text-ve-muted">
            <li>On csr.gov.in, open the company-wise or project-wise CSR data and download it.</li>
            <li>If it downloads as Excel, open it and save it as CSV.</li>
            <li>
              It needs a company name, financial year and amount spent column. CIN, prescribed amount, development sector, state and
              project columns are used when present. Title rows above the headings are fine.
            </li>
          </ol>
          <ImportForm />
        </section>
      ) : null}

      <section aria-labelledby="history-heading" className="grid gap-3">
        <h2 id="history-heading" className="text-xl font-bold">
          Recent imports
        </h2>
        {imports.length ? (
          <div className="relative overflow-x-auto rounded-lg border border-ve-line bg-white">
            <table className="w-full min-w-[44rem] text-left text-sm">
              <caption className="sr-only">Recent imports, newest first</caption>
              <thead className="bg-ve-cream">
                <tr>
                  <th scope="col" className="label px-3 py-2 text-xs text-ve-muted">File</th>
                  <th scope="col" className="label px-3 py-2 text-xs text-ve-muted">Status</th>
                  <th scope="col" className="label px-3 py-2 text-xs text-ve-muted">Result</th>
                  <th scope="col" className="label px-3 py-2 text-xs text-ve-muted">Uploaded</th>
                </tr>
              </thead>
              <tbody>
                {imports.map((i) => (
                  <tr key={i.id} className="border-t border-ve-line align-top">
                    <th scope="row" className="px-3 py-3 font-medium">
                      {i.fileName}
                      <span className="block text-xs font-normal text-ve-muted">{i.source}</span>
                    </th>
                    <td className="px-3 py-3">
                      <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-medium ${STATUS[i.status]!.style}`}>
                        {STATUS[i.status]!.label}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      {i.status === "done" ? (
                        <>
                          {i.companies} companies from {i.rowsRead} rows, {i.fundersCreated} new
                        </>
                      ) : null}
                      {i.error ? <span className="block text-bad">{i.error}</span> : null}
                      {i.problems?.length ? (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-ve-olive">
                            {i.problems.length} {i.problems.length === 1 ? "row" : "rows"} skipped
                          </summary>
                          <ul className="mt-1 list-disc pl-5 text-ve-muted">
                            {i.problems.map((p) => (
                              <li key={`${p.row}-${p.message}`}>
                                Row {p.row}: {p.message}
                              </li>
                            ))}
                          </ul>
                        </details>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      {formatDate(i.createdAt)}
                      <span className="block text-xs text-ve-muted">{i.creator?.name ?? i.creator?.email ?? "Set up by VE"}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-ve-muted">Nothing imported yet.</p>
        )}
      </section>
    </>
  );
}
