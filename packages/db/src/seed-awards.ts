/**
 * Loads the recurring awards VE already knows about. Safe in any environment and safe to re-run:
 * a call that already exists (matched on its title) is left exactly as VE has edited it.
 */
import { blankChecklist, callEligibility } from "@ve/core";
import { sql } from "drizzle-orm";
import { AWARDS_SEED } from "./awards-seed-data";
import { db, funders, opportunities } from "./index";

/** Finds a funder by name, or adds it. */
export async function funderIdFor(name: string, type: (typeof funders.$inferInsert)["type"]): Promise<string> {
  const existing = await db.query.funders.findFirst({ where: sql`lower(${funders.name}) = lower(${name})` });
  if (existing) return existing.id;
  const [f] = await db.insert(funders).values({ name, type }).onConflictDoNothing().returning({ id: funders.id });
  return f?.id ?? (await db.query.funders.findFirst({ where: sql`lower(${funders.name}) = lower(${name})` }))!.id;
}

export async function seedAwards() {
  const checks = blankChecklist();
  const { verdict, reasons } = callEligibility(checks);
  let added = 0;
  for (const a of AWARDS_SEED) {
    const funderId = await funderIdFor(a.organiser, a.organiserType);
    const rows = await db
      .insert(opportunities)
      .values({
        funderId,
        kind: a.kind,
        title: a.title,
        url: a.url,
        usualWindow: a.usualWindow,
        amountNote: a.amountNote,
        categories: a.categories,
        notes: a.notes,
        checks,
        eligibility: verdict,
        eligibilityReasons: reasons,
      })
      .onConflictDoNothing()
      .returning({ id: opportunities.id });
    added += rows.length;
  }
  console.log(`Awards calendar: added ${added} of ${AWARDS_SEED.length} known recurring awards`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await seedAwards();
  process.exit(0);
}
