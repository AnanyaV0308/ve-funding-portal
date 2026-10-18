/**
 * Loads VE's starting facts. Safe in any environment and safe to re-run: existing facts
 * (matched on category and title) are left exactly as VE has edited them.
 */
import { KNOWLEDGE_CATEGORY_LABELS } from "@ve/core";
import { db, knowledgeFacts } from "./index";
import { KNOWLEDGE_SEED } from "./knowledge-seed-data";

export async function seedKnowledge() {
  const inserted = await db
    .insert(knowledgeFacts)
    .values(
      KNOWLEDGE_SEED.map((f) => ({
        ...f,
        refreshMonths: KNOWLEDGE_CATEGORY_LABELS[f.category].refreshMonths,
      })),
    )
    .onConflictDoNothing({ target: [knowledgeFacts.category, knowledgeFacts.title] })
    .returning({ id: knowledgeFacts.id });
  console.log(`Knowledge base: added ${inserted.length} of ${KNOWLEDGE_SEED.length} starting facts`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await seedKnowledge();
  process.exit(0);
}
