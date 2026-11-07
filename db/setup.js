import { readFile } from "node:fs/promises";
import { createPool } from "./pool.js";

// Explicit local/development setup, not a server-startup migration.
let pool;
try {
  pool = createPool();
  const sql = await readFile(new URL("./schema.sql", import.meta.url), "utf8");
  await pool.query(sql);
  console.log("Database ready: assignment9.items. Existing items were preserved.");
} catch {
  console.error("Database setup failed. Check DATABASE_URL, database access, and schema permissions.");
  process.exitCode = 1;
} finally {
  await pool?.end();
}
