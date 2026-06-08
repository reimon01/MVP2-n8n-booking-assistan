/**
 * Aplica db/schema.sql y db/seed.sql a la base de DATABASE_URL.
 * Uso: npm run db:setup
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbDir = join(__dirname, "..", "db");

async function run() {
  const pool = new pg.Pool({
    connectionString:
      process.env.DATABASE_URL ?? "postgres://vida:vida@localhost:5432/vida_v2",
  });
  const schema = readFileSync(join(dbDir, "schema.sql"), "utf8");
  const seed = readFileSync(join(dbDir, "seed.sql"), "utf8");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(schema);
    await client.query(seed);
    await client.query("COMMIT");
    console.log("✔ Esquema y seed aplicados.");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
