import { readFile } from "node:fs/promises";
import { csrYears, dataImports, db, funderGrantees, funders } from "@ve/db";
import { eq, inArray, sql } from "drizzle-orm";
import { importCsrText } from "./import-csr";
import { rescoreFunders } from "./score";

/**
 * Fictional CSR data so the leads screens have something to show in development. Runs only when
 * there's no CSR data yet. Every company name starts with "Example:".
 */
export async function seedDemoLeads(log: (message: string) => void = console.log) {
  const [existing] = await db.select({ count: sql<number>`count(*)::int` }).from(csrYears);
  if (existing!.count > 0) return log("CSR leads: data already loaded, skipping the examples");

  const text = await readFile(new URL("../fixtures/csr-portal-example.csv", import.meta.url), "utf8");
  const [row] = await db
    .insert(dataImports)
    .values({ source: "Example data", fileKey: "fixtures/csr-portal-example.csv", fileName: "csr-portal-example.csv", status: "running" })
    .returning({ id: dataImports.id });
  const result = await importCsrText(row!.id, text, "auto");
  await db
    .update(dataImports)
    .set({ status: "done", rowsRead: result.rowsRead, companies: result.companies, fundersCreated: result.fundersCreated, problems: result.problems, finishedAt: sql`now()` })
    .where(eq(dataImports.id, row!.id));

  // A few things VE would add by hand: who a company funds, and a warm path.
  const named = await db
    .select({ id: funders.id, name: funders.name })
    .from(funders)
    .where(inArray(funders.name, ["Example: Deccan Semiconductors India", "Example: Hooghly Jute Mills", "Example: Kalinga Minerals"]));
  const id = (name: string) => named.find((f) => f.name === name)?.id;
  const grantees = [
    { funderId: id("Example: Deccan Semiconductors India"), name: "Saksham", fy: "2023-24", amount: 4_000_000 },
    { funderId: id("Example: Deccan Semiconductors India"), name: "Enable India", fy: "2023-24", amount: 2_500_000 },
    { funderId: id("Example: Hooghly Jute Mills"), name: "National Association for the Blind", fy: "2023-24", amount: 1_500_000 },
    { funderId: id("Example: Kalinga Minerals"), name: "An Odisha district hospital", fy: "2023-24", amount: 6_000_000 },
  ].filter((g): g is typeof g & { funderId: string } => Boolean(g.funderId));
  if (grantees.length) {
    await db.insert(funderGrantees).values(grantees.map((g) => ({ ...g, sourceLabel: "Example data" })));
  }
  const deccan = id("Example: Deccan Semiconductors India");
  if (deccan) await db.update(funders).set({ warmPath: "Example: a VE trustee knows their CSR head." }).where(eq(funders.id, deccan));
  await rescoreFunders(named.map((f) => f.id));

  log(`CSR leads: loaded ${result.companies} example companies`);
}
