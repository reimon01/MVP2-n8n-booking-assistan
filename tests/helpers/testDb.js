/**
 * Helper para tests contra PostgreSQL real (v2.0).
 * Si la base no es alcanzable, los tests dependientes se omiten.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbDir = join(__dirname, "..", "..", "db");

export const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ?? "postgres://vida:vida@localhost:5433/vida_v2_test",
});

export const SEED = {
  tenantId: "11111111-1111-1111-1111-111111111111",
  timezone: "America/Hermosillo",
  services: {
    corte: "33333333-3333-3333-3333-333333333331",
    manicure: "33333333-3333-3333-3333-333333333332",
    pedicure: "33333333-3333-3333-3333-333333333333",
    pestanas: "33333333-3333-3333-3333-333333333334",
  },
  customer: "44444444-4444-4444-4444-444444444441",
  customerPhone: "+5216621234567",
  existingAppointment: "55555555-5555-5555-5555-555555555551",
};

let reachable = null;

export async function isDbReachable() {
  if (reachable !== null) return reachable;
  try {
    await pool.query("SELECT 1");
    reachable = true;
  } catch {
    reachable = false;
  }
  return reachable;
}

export async function resetSchema() {
  const schema = readFileSync(join(dbDir, "schema.sql"), "utf8");
  const seed = readFileSync(join(dbDir, "seed.sql"), "utf8");
  const client = await pool.connect();
  try {
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await client.query(schema);
    await client.query(seed);
  } finally {
    client.release();
  }
}

export async function closePool() {
  await pool.end();
}
