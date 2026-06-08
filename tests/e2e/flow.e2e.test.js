/**
 * E2E v2.0 — criterio de éxito del Documento 1:
 *   Cliente: "Quiero manicure mañana"
 *   Sistema: ¿A qué hora prefieres? ...
 *   Cliente: 1
 *   Sistema: Confirmo manicure ... ¿Está bien?
 *   Cliente: Sí
 *   Sistema: Listo, tu cita quedó agendada.
 *
 * Más: idempotencia y cancelación. Se omite si no hay base alcanzable.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { processInbound } from "../../src/lib/orchestrator.js";
import { StubLlm, out } from "../helpers/stubLlm.js";
import { pool, isDbReachable, resetSchema, closePool, SEED } from "../helpers/testDb.js";

const NOW = "2026-06-07T18:00:00.000Z";
const available = await isDbReachable();
const d = available ? describe : describe.skip;

d("E2E v2.0", () => {
  beforeEach(async () => {
    await resetSchema();
  });
  afterAll(async () => {
    await closePool();
  });

  it("agenda una cita de extremo a extremo", async () => {
    const phone = SEED.customerPhone; // cliente con nombre → no pide nombre
    const llm = new StubLlm([
      out("BOOK_APPOINTMENT", { serviceId: SEED.services.manicure, serviceName: "Manicure", requestedDate: "2026-06-08" }),
      out("UNKNOWN", {}), // "1"
      out("CONFIRM", { confirmation: "YES" }), // "sí"
    ]);
    const send = (text, id) =>
      processInbound(pool, { tenantId: SEED.tenantId, phone, messageText: text, messageId: id, receivedAt: NOW }, { llm });

    const r1 = await send("Quiero manicure mañana", "m1");
    expect(r1.reply.toLowerCase()).toContain("horarios disponibles");

    const r2 = await send("1", "m2");
    expect(r2.reply.toLowerCase()).toContain("confirmo");

    const r3 = await send("sí", "m3");
    expect(r3.reply.toLowerCase()).toContain("agendada");

    // El primer hueco de manicure es 17:00Z (16:00-17:00Z está ocupado por el seed).
    const rows = await pool.query(
      `SELECT * FROM appointments
        WHERE tenant_id = $1 AND service_id = $2 AND status = 'CONFIRMED'
          AND starts_at = '2026-06-08T17:00:00Z'`,
      [SEED.tenantId, SEED.services.manicure],
    );
    expect(rows.rows.length).toBe(1);
  });

  it("es idempotente ante el mismo messageId", async () => {
    const phone = "+5216629990000";
    const llm = new StubLlm([out("ASK_SERVICES", {}), out("ASK_SERVICES", {})]);
    const first = await processInbound(
      pool,
      { tenantId: SEED.tenantId, phone, messageText: "¿Qué servicios tienen?", messageId: "dup1", receivedAt: NOW },
      { llm },
    );
    expect(first.duplicate).toBeFalsy();
    expect(first.reply.toLowerCase()).toContain("servicios");

    const second = await processInbound(
      pool,
      { tenantId: SEED.tenantId, phone, messageText: "¿Qué servicios tienen?", messageId: "dup1", receivedAt: NOW },
      { llm },
    );
    expect(second.duplicate).toBe(true);
  });

  it("cancela la cita existente con confirmación", async () => {
    const phone = SEED.customerPhone;
    const llm = new StubLlm([
      out("CANCEL_APPOINTMENT", {}),
      out("CONFIRM", { confirmation: "YES" }),
    ]);
    const send = (text, id) =>
      processInbound(pool, { tenantId: SEED.tenantId, phone, messageText: text, messageId: id, receivedAt: NOW }, { llm });

    const r1 = await send("Quiero cancelar mi cita", "c1");
    expect(r1.reply.toLowerCase()).toContain("cancelar");

    const r2 = await send("sí", "c2");
    expect(r2.reply.toLowerCase()).toContain("cancelada");

    const rows = await pool.query("SELECT status FROM appointments WHERE id = $1", [
      SEED.existingAppointment,
    ]);
    expect(rows.rows[0].status).toBe("CANCELLED");
  });
});
