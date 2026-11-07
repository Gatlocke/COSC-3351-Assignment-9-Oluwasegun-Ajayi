import { createApp } from "./app.js";
import { createPool } from "./db/pool.js";
import { createServer } from "node:http";

const portValue = process.env.PORT ?? "3000";
const port = Number(portValue);
if (!/^\d+$/.test(portValue) || !Number.isInteger(port) || port < 0 || port > 65535) {
  console.error("PORT must be an integer from 0 to 65535.");
  process.exit(1);
}

let pool;
try {
  pool = createPool();
  // Verify both connectivity and schema before accepting API requests. No DDL here.
  await pool.query("SELECT id, title, completed FROM assignment9.items LIMIT 0");
  const server = createServer(createApp({ pool }));
  // Read address() only after Node confirms that binding succeeded.
  server.once("listening", () => {
    console.log(`Assignment 9 API listening on http://localhost:${server.address().port}`);
    console.log("Storage: PostgreSQL assignment9.items. Data survives API restarts.");
  });
  server.once("error", async (error) => {
    console.error(error.code === "EADDRINUSE"
      ? `Cannot start API: port ${port} is already in use (EADDRINUSE). Stop the existing server or choose another PORT.`
      : "Cannot start API. Check PORT and network permissions.");
    await pool.end();
    process.exitCode = 1;
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      server.close(async () => {
        await pool.end();
        process.exit(0);
      });
    });
  }
  server.listen(port, "0.0.0.0");
} catch {
  console.error("Database not ready. Check DATABASE_URL and run npm run db:setup for local/development setup.");
  await pool?.end();
  process.exitCode = 1;
}
