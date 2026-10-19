import { runPending } from "./pending";
import { checkDueSources, findReports, runPeerReports } from "./peer-reports";
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
  } else throw new Error(`Unknown command "${command}". Use run-pending, seed-demo, peer-reports, find-reports <url> or report-pages <pdf url>.`);
  process.exit(0);
} catch (e) {
  console.error(e);
  process.exit(1);
}
