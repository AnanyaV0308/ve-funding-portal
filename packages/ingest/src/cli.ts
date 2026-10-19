import { readFile } from "node:fs/promises";
import { checkAnnualReport, csrPagesToRead } from "@ve/core";
import { db, funders } from "@ve/db";
import { ilike } from "drizzle-orm";
import { checkDueCompanies, lookForReport, runCompanyReports } from "./company-reports";
import { runPending } from "./pending";
import { checkDueSources, findReports, runPeerReports } from "./peer-reports";
import { pageTexts } from "./pdf";
import { donorPages } from "./read-report";
import { seedDemoLeads } from "./seed-demo";
import { fetchPublic } from "./web";

const command = process.argv[2];
try {
  if (command === "run-pending") await runPending();
  else if (command === "seed-demo") await seedDemoLeads();
  else if (command === "peer-reports") {
    // With an NGO's name, only looks at that NGO's page (and reads nothing).
    if (process.argv[3]) await checkDueSources(console.log, process.argv[3]);
    else await runPeerReports();
  } else if (command === "find-reports") {
    // Lists the reports the portal would find on a page, without saving anything.
    for (const r of await findReports(process.argv[3]!)) console.log(`${r.fy ?? "year?"}  ${r.text}\n         ${r.url}`);
  } else if (command === "report-pages") {
    // Shows which pages of a report would be sent to be read, without sending anything.
    const file = await fetchPublic(process.argv[3]!, 150e6);
    const { pages, read, bytes } = await donorPages(file.body);
    console.log(
      `${(file.body.byteLength / 1e6).toFixed(1)} MB, ${pages} pages. Would read ${read ? `pages ${read.join(", ")}` : "the whole report"} (${(bytes.byteLength / 1e6).toFixed(1)} MB).`,
    );
  } else if (command === "company-reports") {
    // With a company's name, looks for that company's report now, due or not.
    const name = process.argv[3];
    if (!name) await runCompanyReports();
    else {
      const company = await db.query.funders.findFirst({ where: ilike(funders.name, name), columns: { id: true, name: true, cin: true } });
      if (!company) throw new Error(`No company is called "${name}".`);
      console.log(`${company.name}: ${await lookForReport(company)}`);
    }
  } else if (command === "company-checks") {
    // Looks for every report that's due now, not just a few.
    console.log(`Looked for ${await checkDueCompanies(console.log, Number.MAX_SAFE_INTEGER)} companies' reports.`);
  } else if (command === "csr-pages") {
    // Shows which pages of a company's annual report would be read, without sending anything. Takes a link or a file on this computer.
    const [where, company] = [process.argv[3]!, process.argv[4]];
    const pdf = /^https?:\/\//.test(where) ? (await fetchPublic(where, 150e6)).body : new Uint8Array(await readFile(where));
    const { pages, texts } = await pageTexts(pdf);
    const read = csrPagesToRead(texts);
    if (company) console.log(JSON.stringify(checkAnnualReport(texts, company)));
    console.log(`${(pdf.byteLength / 1e6).toFixed(1)} MB, ${pages} pages. Would read ${read ? `pages ${read.join(", ")}` : "nothing: no page reads like the CSR section"}.`);
  } else {
    throw new Error(
      `Unknown command "${command}". Use run-pending, seed-demo, peer-reports, find-reports <url>, report-pages <pdf url>, company-reports [name], company-checks or csr-pages <pdf url or file> [company name].`,
    );
  }
  process.exit(0);
} catch (e) {
  console.error(e);
  process.exit(1);
}
