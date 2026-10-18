/**
 * Example award and grant calls for local development, with deadlines a few weeks from today so the
 * calendar and reminders have something to show. The organisers are fictional and named as such.
 * Only runs when there are no example calls yet.
 */
import {
  addDays,
  blankChecklist,
  type CallKind,
  callEligibility,
  type CheckAnswer,
  type EligibilityCheck,
  type FunderType,
} from "@ve/core";
import { and, eq, like, sql } from "drizzle-orm";
import { db, opportunities, pursuits } from "./index";
import { funderIdFor } from "./seed-awards";

type Demo = {
  organiser: string;
  organiserType: FunderType;
  kind: CallKind;
  title: string;
  opens?: number;
  deadline: number;
  amount: number | null;
  amountNote?: string;
  answers: Partial<Record<EligibilityCheck["key"], CheckAnswer>>;
  skipped?: string;
  /** Title of an example pursuit to link as this call's application. */
  pursuit?: string;
};

const YES = { registration: "yes", years: "yes", fcra: "yes", geography: "yes", budget: "yes", theme: "yes" } as const;

const DEMOS: Demo[] = [
  {
    organiser: "Example: National Accessibility Awards",
    organiserType: "award_body",
    kind: "award",
    title: "Example: Best NGO in assistive technology, 2026",
    opens: -20,
    deadline: 12,
    amount: 500_000,
    answers: YES,
    pursuit: "Best NGO in assistive technology",
  },
  {
    organiser: "Example: Shiksha Foundation",
    organiserType: "foundation",
    kind: "grant",
    title: "Example: Inclusive Education Innovation Grant",
    opens: -10,
    deadline: 25,
    amount: 1_500_000,
    answers: { ...YES, years: "unsure" },
  },
  {
    organiser: "Example: Bharat Inclusion Network",
    organiserType: "award_body",
    kind: "rfp",
    title: "Example: Accessible STEM call for NGO partners",
    opens: 20,
    deadline: 60,
    amount: 2_500_000,
    answers: {},
  },
  {
    organiser: "Example: Global Inclusion Fund",
    organiserType: "award_body",
    kind: "award",
    title: "Example: Global Disability Innovation Prize",
    deadline: 40,
    amount: null,
    amountNote: "USD 50,000",
    answers: { ...YES, fcra: "no" },
  },
  {
    organiser: "Example: Shiksha Foundation",
    organiserType: "foundation",
    kind: "grant",
    title: "Example: Digital Literacy Small Grants",
    deadline: 18,
    amount: 200_000,
    answers: YES,
    skipped: "Below VE's ₹5 lakh floor.",
  },
];

export async function seedDemoCalls() {
  const existing = await db.query.opportunities.findFirst({ where: like(opportunities.title, "Example:%") });
  if (existing) return console.log("Awards calendar: example calls already exist, skipping");

  const today = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
  for (const d of DEMOS) {
    const funderId = await funderIdFor(d.organiser, d.organiserType);
    const checks = blankChecklist().map((c) => ({ ...c, answer: d.answers[c.key] ?? null }));
    const { verdict, reasons } = callEligibility(checks);
    const deadline = addDays(today, d.deadline);
    const [call] = await db
      .insert(opportunities)
      .values({
        funderId,
        kind: d.kind,
        title: d.title,
        opensOn: d.opens === undefined ? null : addDays(today, d.opens),
        deadline,
        amount: d.amount,
        amountNote: d.amountNote ?? null,
        notes: "Example data for trying the calendar.",
        checks,
        eligibility: verdict,
        eligibilityReasons: reasons,
        checkedAt: Object.keys(d.answers).length ? new Date() : null,
        skippedReason: d.skipped ?? null,
        skippedAt: d.skipped ? new Date() : null,
      })
      .returning({ id: opportunities.id });
    if (d.pursuit) {
      await db
        .update(pursuits)
        .set({ opportunityId: call!.id, nextAction: "Submit the application", nextActionDue: deadline })
        .where(and(eq(pursuits.title, d.pursuit), sql`${pursuits.opportunityId} is null`));
    }
  }
  console.log(`Awards calendar: added ${DEMOS.length} example calls`);
}
