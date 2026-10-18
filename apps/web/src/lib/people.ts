import "server-only";
import { db, users } from "@ve/db";
import { asc } from "drizzle-orm";

export async function listPeople() {
  const rows = await db.select({ id: users.id, name: users.name, email: users.email }).from(users).orderBy(asc(users.name));
  return rows.map((r) => ({ id: r.id, name: r.name ?? r.email ?? "Unnamed person" }));
}
