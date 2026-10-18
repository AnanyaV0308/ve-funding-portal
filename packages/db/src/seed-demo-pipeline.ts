/**
 * Example pursuits for local development, so the board isn't empty. The funders are fictional and
 * named as such. Only runs when there are no pursuits yet.
 */
import { defaultProbability, type FunderType, type Stage, type Track } from "@ve/core";
import { count, eq } from "drizzle-orm";
import { db, funders, pursuits, pursuitStageChanges, users } from "./index";

type Demo = { funder: string; type: FunderType; title: string; track: Track; stage: Stage; ask: number | null; owner: string; daysInStage: number; next?: [string, number] };

const DEMOS: Demo[] = [
  { funder: "Example: Deccan Semiconductors India", type: "company", title: "STEM labs in Karnataka, FY27", track: "relationship", stage: "contacted", ask: 4_000_000, owner: "associate", daysInStage: 6, next: ["Follow up on first email", 3] },
  { funder: "Example: Kaveri Auto Components", type: "company", title: "Teacher training, Tamil Nadu", track: "relationship", stage: "qualified", ask: 2_500_000, owner: "associate", daysInStage: 2, next: ["Find a warm path", 5] },
  { funder: "Example: Narmada Steel", type: "company", title: "Accessible science labs", track: "relationship", stage: "in_conversation", ask: 3_000_000, owner: "approver", daysInStage: 30, next: ["Book a site visit", -2] },
  { funder: "Example: Konkan Power", type: "company", title: "Hexis devices for 20 schools", track: "relationship", stage: "proposal_sent", ask: 6_000_000, owner: "approver", daysInStage: 12, next: ["Chase a decision", 10] },
  { funder: "Example: Malnad Foods", type: "company", title: "Anubhav in 10 schools", track: "relationship", stage: "due_diligence", ask: 1_500_000, owner: "associate", daysInStage: 4, next: ["Send audited accounts", 1] },
  { funder: "Example: National Accessibility Awards", type: "award_body", title: "Best NGO in assistive technology", track: "application", stage: "drafting", ask: 500_000, owner: "associate", daysInStage: 3, next: ["Finish the draft", 9] },
];

export async function seedDemoPipeline() {
  const [existing] = await db.select({ n: count() }).from(pursuits);
  if ((existing?.n ?? 0) > 0) return console.log("Pipeline: pursuits already exist, skipping demo data");

  const people = await db.select({ id: users.id, email: users.email }).from(users);
  const ownerId = (who: string) => people.find((p) => p.email === `${who}@demo.visionempower.local`)?.id ?? null;
  const day = 24 * 60 * 60 * 1000;
  const isoIn = (days: number) => new Date(Date.now() + days * day).toISOString().slice(0, 10);

  for (const d of DEMOS) {
    const [f] = await db.insert(funders).values({ name: d.funder, type: d.type }).onConflictDoNothing().returning({ id: funders.id });
    const funderId = f?.id ?? (await db.query.funders.findFirst({ where: eq(funders.name, d.funder) }))!.id;
    const changedAt = new Date(Date.now() - d.daysInStage * day);
    const [p] = await db
      .insert(pursuits)
      .values({
        funderId,
        title: d.title,
        track: d.track,
        stage: d.stage,
        stageChangedAt: changedAt,
        ownerId: ownerId(d.owner),
        askAmount: d.ask,
        nextAction: d.next?.[0] ?? null,
        nextActionDue: d.next ? isoIn(d.next[1]) : null,
      })
      .returning({ id: pursuits.id });
    await db.insert(pursuitStageChanges).values({ pursuitId: p!.id, fromStage: null, toStage: d.stage, changedAt, note: `Demo data (${defaultProbability(d.stage)}%)` });
  }
  console.log(`Pipeline: added ${DEMOS.length} example pursuits`);
}
