import { can, type Permission } from "@ve/core";
import { db } from "@ve/db";

export type Person = { id: string; name: string; email: string; digestEmails: boolean; reminderEmails: boolean; can: (p: Permission) => boolean };

/** Everyone with an email address, with what their roles allow. */
export async function loadPeople(): Promise<Person[]> {
  const rows = await db.query.users.findMany({ with: { roles: true } });
  return rows
    .filter((u) => u.email)
    .map((u) => {
      const roles = u.roles.map((r) => r.role);
      return {
        id: u.id,
        name: u.name ?? u.email!,
        email: u.email!,
        digestEmails: u.digestEmails,
        reminderEmails: u.reminderEmails,
        can: (p: Permission) => can(roles, p),
      };
    });
}
