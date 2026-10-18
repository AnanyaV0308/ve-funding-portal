import "server-only";
import { can, type Permission, type Role } from "@ve/core";
import { db, users } from "@ve/db";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "@/auth";

export type CurrentUser = {
  id: string;
  name: string | null;
  email: string | null;
  roles: Role[];
};

/** The signed-in person with their current roles, or null. Cached for the length of one request. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  const row = await db.query.users.findFirst({ where: eq(users.id, id), with: { roles: true } });
  if (!row) return null;
  return { id: row.id, name: row.name, email: row.email, roles: row.roles.map((r) => r.role) };
});

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  return user;
}

export class NotAllowedError extends Error {
  constructor(permission: Permission) {
    super(`You don't have permission to do this (${permission}). Ask an admin to change your role.`);
  }
}

/** For server actions: every write checks the caller's permission on the server, never just in the UI. */
export async function requirePermission(permission: Permission): Promise<CurrentUser> {
  const user = await requireUser();
  if (!can(user.roles, permission)) throw new NotAllowedError(permission);
  return user;
}
