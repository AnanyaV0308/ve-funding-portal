import { deliverQueued } from "./outbox";
import { runDigest, runReminders, todayInIndia } from "./run";

// pnpm --filter @ve/notify reminders [--date=YYYY-MM-DD]
const command = process.argv[2];
const dateArg = process.argv.find((a) => a.startsWith("--date="))?.slice(7);
if (dateArg && !/^\d{4}-\d{2}-\d{2}$/.test(dateArg)) throw new Error("Use --date=YYYY-MM-DD");
const today = dateArg ?? todayInIndia();
try {
  if (command === "reminders") await runReminders(today);
  else if (command === "digest") await runDigest(today);
  else if (command === "deliver") await deliverQueued();
  else throw new Error(`Unknown command "${command}". Use reminders, digest or deliver.`);
  process.exit(0);
} catch (e) {
  console.error(e);
  process.exit(1);
}
