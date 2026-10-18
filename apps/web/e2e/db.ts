import postgres from "postgres";

/** Direct database access for test setup only. */
export async function withSql<T>(fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(process.env.DATABASE_URL ?? "postgres://ve:ve@localhost:5432/ve_funding", { max: 1 });
  try {
    return await fn(sql);
  } finally {
    await sql.end();
  }
}
