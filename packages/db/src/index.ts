import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export * from "./schema";
export { schema };

// One pool per process. In Next.js dev, hot reloads would otherwise open a new pool each time.
// postgres-js connects lazily, so importing this without DATABASE_URL (e.g. during a build) is safe;
// the first query fails with a clear connection error instead.
const globalForDb = globalThis as unknown as { veSql?: ReturnType<typeof postgres> };
const sql = (globalForDb.veSql ??= postgres(process.env.DATABASE_URL ?? "postgres://localhost/ve_funding", {
  max: 10,
  prepare: false, // required by Supabase's transaction pooler
}));

export const db = drizzle({ client: sql, schema });
export type Db = typeof db;
