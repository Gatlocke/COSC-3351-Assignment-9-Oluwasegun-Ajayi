import pg from "pg";

export function createPool(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) {
    throw new Error("DATABASE_URL is required. Configure the environment or a local .env file.");
  }
  const pool = new pg.Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000,
    statement_timeout: 5000,
  });
  // Never print a connection string or a raw driver error containing credentials.
  pool.on("error", () => console.error("An idle PostgreSQL connection failed."));
  return pool;
}
