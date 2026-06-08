/**
 * Integración v2.0 contra PostgreSQL real.
 *
 *   getAvailability:  horario libre · horario ocupado · fuera de business_hours
 *   createAppointment: cita válida · slot ocupado · servicio inexistente · cliente inexistente
 *   rescheduleAppointment: actualiza la MISMA cita (no crea nueva)
 *   cancelAppointment
 *   concurrencia: dos createAppointment simultáneos → sólo una cita creada
 *
 * Se omite si no hay base alcanzable.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  getAvailability,
  createAppointment,
  cancelAppointment,
  rescheduleAppointment,
  DomainError,
} from "../../src/lib/dbOps.js";
import { pool, isDbReachable, resetSchema, closePool, SEED } from "../helpers/testDb.js";

const MONDAY = "2026-06-08"; // tiene una cita existente 16:00-17:00Z
const FREE_MONDAY = "2026-06-15"; // lunes sin citas
const SUNDAY = "2026-06-07";
const TZ = SEED.timezone;

const available = await isDbReachable();
const d = available ? describe : describe.skip;
if (!available) console.warn("[int v2] DATABASE_URL no alcanzable: integración omitida.");

d("dbOps — integración (PostgreSQL real)", () => {
  beforeEach(async () => {
    await resetSchema();
  });
  afterAll(async () => {
    await closePool();
  });

  describe("getAvailability", () => {
    it("horario libre: día sin citas ofrece desde la apertura (16:00Z)", async () => {
      const out = await getAvailability(pool, {
        tenantId: SEED.tenantId,
        serviceId: SEED.services.pedicure,
        date: FREE_MONDAY,
        timeZone: TZ,
      });
      expect(out.availableSlots.length).toBe(3);
      expect(out.availableSlots[0].startsAt).toBe("2026-06-15T16:00:00.000Z");
    });

    it("horario ocupado: manicure excluye 16:00-17:00Z (cita existente) → primero 17:00Z", async () => {
      const out = await getAvailability(pool, {
        tenantId: SEED.tenantId,
        serviceId: SEED.services.manicure,
        date: MONDAY,
        timeZone: TZ,
      });
      expect(out.availableSlots.some((s) => s.startsAt === "2026-06-08T16:00:00.000Z")).toBe(false);
      expect(out.availableSlots[0].startsAt).toBe("2026-06-08T17:00:00.000Z");
    });

    it("fuera de business_hours: domingo lanza NO_AVAILABILITY", async () => {
      await expect(
        getAvailability(pool, {
          tenantId: SEED.tenantId,
          serviceId: SEED.services.manicure,
          date: SUNDAY,
          timeZone: TZ,
        }),
      ).rejects.toMatchObject({ code: "NO_AVAILABILITY" });
    });

    it("servicio inexistente lanza SERVICE_NOT_FOUND", async () => {
      await expect(
        getAvailability(pool, {
          tenantId: SEED.tenantId,
          serviceId: "00000000-0000-0000-0000-0000000000ff",
          date: MONDAY,
          timeZone: TZ,
        }),
      ).rejects.toMatchObject({ code: "SERVICE_NOT_FOUND" });
    });
  });

  describe("createAppointment", () => {
    it("cita válida: crea CONFIRMED y persiste", async () => {
      const appt = await createAppointment(pool, {
        tenantId: SEED.tenantId,
        customerId: SEED.customer,
        serviceId: SEED.services.manicure,
        startsAt: "2026-06-08T18:00:00.000Z",
      });
      expect(appt.status).toBe("CONFIRMED");
      expect(new Date(appt.ends_at).toISOString()).toBe("2026-06-08T19:00:00.000Z");

      const rows = await pool.query("SELECT * FROM appointments WHERE id = $1", [appt.id]);
      expect(rows.rows.length).toBe(1);
    });

    it("slot ocupado: choca con cita existente → SLOT_NOT_AVAILABLE", async () => {
      await expect(
        createAppointment(pool, {
          tenantId: SEED.tenantId,
          customerId: SEED.customer,
          serviceId: SEED.services.manicure,
          startsAt: "2026-06-08T16:00:00.000Z",
        }),
      ).rejects.toMatchObject({ code: "SLOT_NOT_AVAILABLE" });
    });

    it("servicio inexistente → SERVICE_NOT_FOUND", async () => {
      await expect(
        createAppointment(pool, {
          tenantId: SEED.tenantId,
          customerId: SEED.customer,
          serviceId: "00000000-0000-0000-0000-0000000000ff",
          startsAt: "2026-06-08T18:00:00.000Z",
        }),
      ).rejects.toMatchObject({ code: "SERVICE_NOT_FOUND" });
    });

    it("cliente inexistente → CUSTOMER_NOT_FOUND", async () => {
      await expect(
        createAppointment(pool, {
          tenantId: SEED.tenantId,
          customerId: "00000000-0000-0000-0000-0000000000aa",
          serviceId: SEED.services.manicure,
          startsAt: "2026-06-08T18:00:00.000Z",
        }),
      ).rejects.toMatchObject({ code: "CUSTOMER_NOT_FOUND" });
    });
  });

  describe("rescheduleAppointment (UPDATE de la misma cita)", () => {
    it("actualiza starts_at/ends_at sin crear una nueva cita", async () => {
      const before = await pool.query(
        "SELECT count(*)::int AS n FROM appointments WHERE tenant_id = $1",
        [SEED.tenantId],
      );
      const updated = await rescheduleAppointment(pool, {
        tenantId: SEED.tenantId,
        customerId: SEED.customer,
        appointmentId: SEED.existingAppointment,
        newStartsAt: "2026-06-08T20:00:00.000Z",
      });
      expect(updated.id).toBe(SEED.existingAppointment); // MISMA cita
      expect(new Date(updated.starts_at).toISOString()).toBe("2026-06-08T20:00:00.000Z");
      expect(new Date(updated.ends_at).toISOString()).toBe("2026-06-08T21:00:00.000Z"); // 60m

      const after = await pool.query(
        "SELECT count(*)::int AS n FROM appointments WHERE tenant_id = $1",
        [SEED.tenantId],
      );
      expect(after.rows[0].n).toBe(before.rows[0].n); // no se creó otra
    });
  });

  describe("cancelAppointment", () => {
    it("cancela y luego marca ALREADY_CANCELLED", async () => {
      const out = await cancelAppointment(pool, {
        tenantId: SEED.tenantId,
        customerId: SEED.customer,
        appointmentId: SEED.existingAppointment,
      });
      expect(out.status).toBe("CANCELLED");
      await expect(
        cancelAppointment(pool, {
          tenantId: SEED.tenantId,
          customerId: SEED.customer,
          appointmentId: SEED.existingAppointment,
        }),
      ).rejects.toMatchObject({ code: "APPOINTMENT_ALREADY_CANCELLED" });
    });
  });

  describe("concurrencia (anti-overbooking)", () => {
    it("dos createAppointment simultáneos para el mismo slot: sólo una cita creada", async () => {
      const params = {
        tenantId: SEED.tenantId,
        customerId: SEED.customer,
        serviceId: SEED.services.manicure,
        startsAt: "2026-06-08T18:00:00.000Z",
      };
      const results = await Promise.allSettled([
        createAppointment(pool, params),
        createAppointment(pool, params),
      ]);
      const ok = results.filter((r) => r.status === "fulfilled");
      const failed = results.filter((r) => r.status === "rejected");
      expect(ok.length).toBe(1);
      expect(failed.length).toBe(1);
      expect(failed[0].reason).toBeInstanceOf(DomainError);
      expect(failed[0].reason.code).toBe("SLOT_NOT_AVAILABLE");

      const rows = await pool.query(
        `SELECT count(*)::int AS n FROM appointments
          WHERE tenant_id = $1 AND status = 'CONFIRMED'
            AND starts_at = $2`,
        [SEED.tenantId, params.startsAt],
      );
      expect(rows.rows[0].n).toBe(1);
    });
  });
});
