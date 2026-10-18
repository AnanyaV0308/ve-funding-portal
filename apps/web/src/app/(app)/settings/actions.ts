"use server";

import { isRole, type Role, wouldRemoveLastAdmin } from "@ve/core";
import { auditLog, db, userRoles } from "@ve/db";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { NotAllowedError, requirePermission } from "@/lib/authz";

export type RoleFormState = { ok: boolean; message: string } | null;

const input = z.object({
  userId: z.string().min(1),
  roles: z.array(z.string().refine(isRole, "Unknown role")).max(5),
});

export async function setUserRoles(_prev: RoleFormState, formData: FormData): Promise<RoleFormState> {
  let actor;
  try {
    actor = await requirePermission("users:manage");
  } catch (e) {
    if (e instanceof NotAllowedError) return { ok: false, message: e.message };
    throw e;
  }

  const parsed = input.safeParse({ userId: formData.get("userId"), roles: formData.getAll("roles") });
  if (!parsed.success) return { ok: false, message: "That role change wasn't valid. Reload the page and try again." };
  const { userId } = parsed.data;
  const nextRoles = parsed.data.roles as Role[];

  const result = await db.transaction(async (tx) => {
    // Lock the admin rows so two admins demoting each other at once can't leave zero admins.
    const admins = await tx.execute<{ user_id: string }>(
      sql`select user_id from user_roles where role = 'admin' for update`,
    );
    const adminIds = admins.map((r) => r.user_id);
    if (
      wouldRemoveLastAdmin({
        targetIsAdmin: adminIds.includes(userId),
        nextRoles,
        adminCount: adminIds.length,
      })
    ) {
      return { ok: false, message: "VE needs at least one admin. Make someone else an admin first." };
    }

    const before = await tx.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, userId));
    await tx.delete(userRoles).where(and(eq(userRoles.userId, userId)));
    if (nextRoles.length) {
      await tx.insert(userRoles).values(nextRoles.map((role) => ({ userId, role, grantedBy: actor.id })));
    }
    await tx.insert(auditLog).values({
      actorId: actor.id,
      action: "user.roles_changed",
      targetType: "user",
      targetId: userId,
      detail: { from: before.map((r) => r.role), to: nextRoles },
    });
    return { ok: true, message: "Roles saved." };
  });

  if (result.ok) revalidatePath("/settings");
  return result;
}
