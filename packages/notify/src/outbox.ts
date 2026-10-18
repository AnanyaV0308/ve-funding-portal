import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { db, outboundEmails } from "@ve/db";
import { asc, eq } from "drizzle-orm";

export type NewEmail = {
  kind: "reminder" | "digest";
  /** Unique per email that should only ever go once, e.g. "reminder:<call>:14:<user>". */
  dedupeKey: string;
  toUserId: string;
  toEmail: string;
  subject: string;
  html: string;
  text: string;
  opportunityId?: string;
};

/** Queues an email unless one with the same dedupe key was queued before. Returns whether it was new. */
export async function queueEmail(email: NewEmail): Promise<boolean> {
  const rows = await db.insert(outboundEmails).values(email).onConflictDoNothing({ target: outboundEmails.dedupeKey }).returning({ id: outboundEmails.id });
  return rows.length > 0;
}

function repoRoot(from = process.cwd()): string {
  let dir = from;
  while (!existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
    const up = path.dirname(dir);
    if (up === dir) throw new Error("Couldn't find the repository root");
    dir = up;
  }
  return dir;
}

/**
 * Until VE has an email service account, emails are written to a local folder instead of being
 * sent, so reminders and the digest can be checked end to end. Production refuses rather than
 * silently dropping them.
 */
function outboxDir(): string {
  const dir = process.env.EMAIL_OUTBOX_DIR;
  if (dir) return path.resolve(dir);
  if (process.env.NODE_ENV === "production") {
    throw new Error("Email sending isn't configured for production yet. Set up the email service first.");
  }
  return path.join(repoRoot(), "apps", "web", ".data", "outbox");
}

/** Delivers whatever is queued, oldest first. Returns how many went out. */
export async function deliverQueued(log: (m: string) => void = console.log): Promise<number> {
  const queued = await db.select().from(outboundEmails).where(eq(outboundEmails.status, "queued")).orderBy(asc(outboundEmails.createdAt)).limit(500);
  if (!queued.length) return 0;
  const dir = outboxDir();
  await mkdir(dir, { recursive: true });
  let sent = 0;
  for (const email of queued) {
    try {
      const stamp = email.createdAt.toISOString().replace(/[:.]/g, "-");
      const base = path.join(dir, `${stamp}-${email.kind}-${email.id}`);
      const headers = `To: ${email.toEmail}\nSubject: ${email.subject}\n\n`;
      await writeFile(`${base}.txt`, headers + email.text, "utf8");
      await writeFile(`${base}.html`, email.html, "utf8");
      await db.update(outboundEmails).set({ status: "sent", provider: "outbox", sentAt: new Date(), error: null }).where(eq(outboundEmails.id, email.id));
      sent++;
    } catch (e) {
      await db.update(outboundEmails).set({ status: "failed", error: String(e) }).where(eq(outboundEmails.id, email.id));
    }
  }
  log(`Delivered ${sent} of ${queued.length} emails to ${dir}`);
  return sent;
}
