/**
 * Background worker. Runs scheduled and slow jobs (crawls, scoring, reminders, digests) from a
 * pg-boss queue that lives in the same Postgres as the app.
 */
import { runPending } from "@ve/ingest";
import { PgBoss } from "pg-boss";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env at the repo root.");

const boss = new PgBoss(url);
boss.on("error", (err) => console.error("[worker]", err));

await boss.start();

const HEARTBEAT = "heartbeat";
await boss.createQueue(HEARTBEAT);
await boss.schedule(HEARTBEAT, "*/15 * * * *", {}, { tz: "Asia/Kolkata" });
await boss.work(HEARTBEAT, async () => {
  console.log(`[worker] heartbeat ${new Date().toISOString()}`);
});

// CSR imports people upload, and rescoring after the fit settings change. Each run takes whatever
// is waiting; a single-concurrency queue means two runs never overlap.
const PENDING = "pending-work";
await boss.createQueue(PENDING, { policy: "singleton" });
await boss.schedule(PENDING, "* * * * *", {}, { tz: "Asia/Kolkata" });
await boss.work(PENDING, async () => {
  await runPending((m) => console.log(`[worker] ${m}`));
});

console.log("[worker] started");

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await boss.stop({ graceful: true });
    process.exit(0);
  });
}
