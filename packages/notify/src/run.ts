import { deliverQueued } from "./outbox";
import { queueWeeklyDigest } from "./digest";
import { queueDeadlineReminders } from "./reminders";

type Log = (m: string) => void;

/** Today's date in India as YYYY-MM-DD. */
export function todayInIndia(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Kolkata" }).format(now);
}

/** The daily job: queue today's deadline reminders, then send everything queued. */
export async function runReminders(today = todayInIndia(), log: Log = console.log) {
  await queueDeadlineReminders(today, log);
  await deliverQueued(log);
}

/** The Monday job: queue the weekly digest, then send everything queued. */
export async function runDigest(today = todayInIndia(), log: Log = console.log) {
  await queueWeeklyDigest(today, log);
  await deliverQueued(log);
}
