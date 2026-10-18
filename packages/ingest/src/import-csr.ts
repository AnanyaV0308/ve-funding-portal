import { type AmountUnit, AMOUNT_UNITS, groupCsrRecords, readCsrCsv } from "@ve/core";
import { csrBreakdown, csrYears, dataImports, db, funders } from "@ve/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { readStoredText } from "./files";
import { recentFys, rescoreFunders } from "./score";

export const CSR_PORTAL = "National CSR Portal";
const CHUNK = 200;
const MAX_PROBLEMS = 50;

/**
 * Loads CSR spend from a CSV into the database. Companies are matched on CIN, then on name;
 * new ones are added as funders. A year in the file replaces what was stored for that company and
 * year, so importing a corrected file is safe. Returns what the import page shows.
 */
export async function importCsrText(importId: string, text: string, unit: AmountUnit = "auto") {
  const read = readCsrCsv(text, unit);
  const companies = groupCsrRecords(read.records);
  const fysBefore = (await recentFys()).join();

  const existing = await db.select({ id: funders.id, cin: funders.cin, name: funders.name }).from(funders);
  const byCin = new Map(existing.filter((f) => f.cin).map((f) => [f.cin!, f]));
  const byName = new Map(existing.map((f) => [f.name.toLowerCase(), f]));

  let created = 0;
  const touched: string[] = [];

  for (let i = 0; i < companies.length; i += CHUNK) {
    const chunk = companies.slice(i, i + CHUNK);
    await db.transaction(async (tx) => {
      for (const c of chunk) {
        let funder = (c.cin && byCin.get(c.cin)) || undefined;
        const sameName = byName.get(c.name.toLowerCase());
        if (!funder && sameName && (!sameName.cin || !c.cin)) {
          funder = sameName;
          if (c.cin && !sameName.cin) {
            await tx.update(funders).set({ cin: c.cin }).where(eq(funders.id, sameName.id));
            funder = { ...sameName, cin: c.cin };
            byCin.set(c.cin, funder);
          }
        }
        if (!funder) {
          // Two different companies can share a name; the CIN keeps them apart.
          const name = sameName ? `${c.name} (${c.cin})` : c.name;
          const [row] = await tx
            .insert(funders)
            .values({ name, type: "company", cin: c.cin })
            .returning({ id: funders.id, cin: funders.cin, name: funders.name });
          funder = row!;
          created++;
          byName.set(name.toLowerCase(), funder);
          if (c.cin) byCin.set(c.cin, funder);
        }
        const fys = [...c.years.keys()];
        await tx.delete(csrYears).where(and(eq(csrYears.funderId, funder.id), inArray(csrYears.fy, fys)));
        await tx.delete(csrBreakdown).where(and(eq(csrBreakdown.funderId, funder.id), inArray(csrBreakdown.fy, fys)));
        await tx.insert(csrYears).values(
          [...c.years.values()].map((y) => ({
            funderId: funder.id,
            fy: y.fy,
            spent: y.spent,
            prescribed: y.prescribed,
            projectCount: y.projectCount,
            importId,
          })),
        );
        const lines = [...c.years.values()].flatMap((y) => [
          ...[...y.sectors].map(([name, amount]) => ({ funderId: funder.id, fy: y.fy, kind: "sector" as const, name, amount })),
          ...[...y.states].map(([name, amount]) => ({ funderId: funder.id, fy: y.fy, kind: "state" as const, name, amount })),
        ]);
        if (lines.length) await tx.insert(csrBreakdown).values(lines);
        touched.push(funder.id);
      }
    });
  }

  // A new latest year changes every company's eligibility, so then score them all; otherwise just these.
  await rescoreFunders((await recentFys()).join() === fysBefore ? touched : undefined);

  return {
    rowsRead: read.rowsRead,
    companies: companies.length,
    fundersCreated: created,
    problems: read.errors.slice(0, MAX_PROBLEMS),
    unit: read.unit,
  };
}

/** Runs one queued import end to end and records the outcome on its row. */
export async function runImport(importId: string) {
  const row = await db.query.dataImports.findFirst({ where: eq(dataImports.id, importId) });
  if (!row) return;
  try {
    const text = await readStoredText(row.fileKey);
    const unit = (AMOUNT_UNITS as readonly string[]).includes(row.unit) ? (row.unit as AmountUnit) : "auto";
    const result = await importCsrText(row.id, text, unit);
    const failed = result.companies === 0;
    await db
      .update(dataImports)
      .set({
        status: failed ? "failed" : "done",
        rowsRead: result.rowsRead,
        companies: result.companies,
        fundersCreated: result.fundersCreated,
        problems: result.problems,
        error: failed ? (result.problems[0]?.message ?? "No rows could be read.") : null,
        finishedAt: sql`now()`,
      })
      .where(eq(dataImports.id, row.id));
  } catch (e) {
    console.error("[ingest] import failed", row.id, e);
    await db
      .update(dataImports)
      .set({ status: "failed", error: e instanceof Error ? e.message : String(e), finishedAt: sql`now()` })
      .where(eq(dataImports.id, row.id));
  }
}

/** Takes the oldest queued import, so two workers never run the same one. */
export async function claimNextImport(): Promise<string | null> {
  const rows = await db.execute<{ id: string }>(sql`
    update data_imports set status = 'running', started_at = now()
    where id = (select id from data_imports where status = 'queued' order by created_at limit 1 for update skip locked)
    returning id`);
  return rows[0]?.id ?? null;
}
