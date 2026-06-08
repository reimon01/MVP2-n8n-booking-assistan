/**
 * Setup de vitest: carga `.env.test` (si existe) para apuntar a la base de
 * pruebas dedicada. Un DATABASE_URL exportado en el shell tiene prioridad.
 */
import { existsSync } from "node:fs";
import { config } from "dotenv";

if (existsSync(".env.test")) {
  config({ path: ".env.test" });
}
