// One-off operational utility: applies a raw SQL migration file directly against
// Postgres via the DB connection string (DATABASE_URL env var — the Postgres
// superuser password, NOT the anon/service-role API keys used everywhere else in
// this app). Never reads that credential from apps/brain-map/.env — it is
// deliberately a higher-privilege, rarer-use secret than the app's own runtime
// keys and is not persisted to disk by this script or anywhere else in this repo.
//
// Usage: DATABASE_URL="postgres://..." node scripts/apply-migration.mjs <path-to-sql-file>

import { readFile } from "node:fs/promises";
import pg from "pg";

const sqlPath = process.argv[2];
if (!sqlPath) {
  console.error("Usage: DATABASE_URL=... node scripts/apply-migration.mjs <path-to-sql-file>");
  process.exit(1);
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const sql = await readFile(sqlPath, "utf-8");
const client = new pg.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  await client.query(sql);
  console.log(`Applied ${sqlPath} successfully.`);
} catch (err) {
  console.error(`Migration failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
