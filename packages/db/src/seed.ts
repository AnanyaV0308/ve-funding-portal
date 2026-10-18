/**
 * Local demo data: one person per role, so every screen can be tried without Microsoft sign-in,
 * plus VE's starting knowledge-base facts, the awards VE knows about, and example pursuits and calls.
 * Safe to run more than once.
 */
import type { Role } from "@ve/core";
import { db, userRoles, users } from "./index";
import { seedAwards } from "./seed-awards";
import { seedDemoCalls } from "./seed-demo-calls";
import { seedDemoPipeline } from "./seed-demo-pipeline";
import { seedKnowledge } from "./seed-knowledge";

const people: { name: string; email: string; roles: Role[] }[] = [
  { name: "Demo Admin", email: "admin@demo.visionempower.local", roles: ["admin"] },
  { name: "Demo Approver", email: "approver@demo.visionempower.local", roles: ["approver"] },
  { name: "Demo Associate", email: "associate@demo.visionempower.local", roles: ["associate"] },
  { name: "Demo Introducer", email: "introducer@demo.visionempower.local", roles: ["introducer"] },
  { name: "Demo Viewer", email: "viewer@demo.visionempower.local", roles: ["viewer"] },
];

for (const p of people) {
  const [u] = await db
    .insert(users)
    .values({ name: p.name, email: p.email })
    .onConflictDoUpdate({ target: users.email, set: { name: p.name } })
    .returning({ id: users.id });
  if (!u) continue;
  await db
    .insert(userRoles)
    .values(p.roles.map((role) => ({ userId: u.id, role })))
    .onConflictDoNothing();
}

console.log(`Seeded ${people.length} demo users`);
await seedKnowledge();
await seedDemoPipeline();
await seedAwards();
await seedDemoCalls();
process.exit(0);
