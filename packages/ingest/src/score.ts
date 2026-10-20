import { assessCompany, planFacts } from "@ve/core";
import { companyReports, csrBreakdown, csrPlans, csrYears, db, funderGrantees, funders, getFitSettings } from "@ve/db";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";

const CHUNK = 500;

/** The two most recent financial years in the CSR data, newest first. */
export async function recentFys(): Promise<string[]> {
  const rows = await db.selectDistinct({ fy: csrYears.fy }).from(csrYears).orderBy(desc(csrYears.fy)).limit(2);
  return rows.map((r) => r.fy);
}

/** What the fit score uses from a company's newest annual report that was read. */
function newestReport(r: { fy: string | null; obligation: number | null; disabilityWork: unknown[] } | undefined) {
  return r?.fy ? { fy: r.fy, obligation: r.obligation, disabilityWork: r.disabilityWork.length > 0 } : null;
}

/** What the fit score uses from a company's newest CSR action plan that was read. */
function newestPlan(p: { fy: string | null; budget: number | null; projects: Parameters<typeof planFacts>[0]["projects"] } | undefined) {
  return p?.fy ? planFacts({ fy: p.fy, budget: p.budget, projects: p.projects }) : null;
}

/**
 * Works out eligibility, grant size and fit score again for the given companies, or for every
 * company when no ids are given, and stores the results on the funder rows the leads list reads.
 */
export async function rescoreFunders(ids?: string[]): Promise<number> {
  const settings = await getFitSettings();
  const fys = await recentFys();
  const targets =
    ids ?? (await db.select({ id: funders.id }).from(funders).where(eq(funders.type, "company"))).map((r) => r.id);

  for (let i = 0; i < targets.length; i += CHUNK) {
    const chunk = targets.slice(i, i + CHUNK);
    const [rows, years, breakdown, grantees, reports, plans] = await Promise.all([
      db.select().from(funders).where(inArray(funders.id, chunk)),
      db.select().from(csrYears).where(inArray(csrYears.funderId, chunk)),
      db.select().from(csrBreakdown).where(inArray(csrBreakdown.funderId, chunk)),
      db.select().from(funderGrantees).where(inArray(funderGrantees.funderId, chunk)),
      db
        .select({ funderId: companyReports.funderId, fy: companyReports.fy, obligation: companyReports.obligation, disabilityWork: companyReports.disabilityWork })
        .from(companyReports)
        .where(and(inArray(companyReports.funderId, chunk), eq(companyReports.status, "read"), isNotNull(companyReports.fy)))
        .orderBy(desc(companyReports.fy)),
      db
        .select({ funderId: csrPlans.funderId, fy: csrPlans.fy, budget: csrPlans.budget, projects: csrPlans.projects })
        .from(csrPlans)
        .where(and(inArray(csrPlans.funderId, chunk), eq(csrPlans.status, "read"), isNotNull(csrPlans.fy)))
        .orderBy(desc(csrPlans.fy), desc(csrPlans.foundAt)),
    ]);
    const now = new Date();
    await db.transaction(async (tx) => {
      for (const f of rows) {
        if (f.type !== "company") continue;
        const own = breakdown.filter((b) => b.funderId === f.id);
        const pick = (fy: string, kind: "sector" | "state") =>
          new Map(own.filter((b) => b.fy === fy && b.kind === kind).map((b) => [b.name, b.amount]));
        const r = assessCompany(
          {
            cin: f.cin,
            isForeign: f.isForeign,
            years: years
              .filter((y) => y.funderId === f.id)
              .map((y) => ({ ...y, sectors: pick(y.fy, "sector"), states: pick(y.fy, "state") })),
            grantees: grantees.filter((g) => g.funderId === f.id),
            warmPath: Boolean(f.warmPath?.trim()),
            report: newestReport(reports.find((r) => r.funderId === f.id)),
            plan: newestPlan(plans.find((p) => p.funderId === f.id)),
          },
          fys,
          settings,
        );
        await tx
          .update(funders)
          .set({
            eligibility: r.eligibility.verdict,
            eligibilityReasons: r.eligibility.reasons,
            fitScore: r.fit.score,
            fitParts: r.fit.parts,
            fitSummary: r.fit.summary,
            latestFy: r.latest?.fy ?? null,
            latestSpend: r.latest?.spent ?? null,
            ticketEstimate: r.ticket.amount,
            ticketBasis: r.ticket.basis,
            scoredAt: now,
          })
          .where(eq(funders.id, f.id));
      }
    });
  }
  return targets.length;
}
