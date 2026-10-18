"use server";

import { auditLog, db, users } from "@ve/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { NotAllowedError, requirePermission } from "@/lib/authz";

export type EmailPrefsState = { ok: boolean; message: string } | null;

/** Each person chooses which emails they get. Only ever changes the signed-in person's own choices. */
export async function saveEmailPrefs(_prev: EmailPrefsState, formData: FormData): Promise<EmailPrefsState> {
  let user;
  try {
    user = await requirePermission("profile:edit");
  } catch (e) {
    if (e instanceof NotAllowedError) return { ok: false, message: e.message };
    throw e;
  }
  const prefs = {
    digestEmails: formData.get("digestEmails") === "on",
    reminderEmails: formData.get("reminderEmails") === "on",
  };
  await db.update(users).set(prefs).where(eq(users.id, user.id));
  await db.insert(auditLog).values({
    actorId: user.id,
    action: "user.email_prefs",
    targetType: "user",
    targetId: user.id,
    detail: prefs,
  });
  revalidatePath("/settings");
  return { ok: true, message: "Email choices saved." };
}
