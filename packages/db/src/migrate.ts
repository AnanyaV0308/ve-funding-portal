import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

const sql = postgres(url, { max: 1 });
await migrate(drizzle({ client: sql }), { migrationsFolder: new URL("../migrations", import.meta.url).pathname });
await sql.end();
console.log("Migrations applied");
