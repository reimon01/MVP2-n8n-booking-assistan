/**
 * Operaciones de base de datos (v2.0).
 *
 * Reflejan lo que en n8n harían los nodos Postgres. Cada función recibe un
 * `db` (Pool o Client de `pg`). La creación/reagendamiento usan SQL atómico
 * + la restricción EXCLUDE como red de seguridad anti-overbooking.
 */
import { generateSlots, dayOfWeekForDate } from "./availability.js";
import { localToUtc, addMinutes } from "./time.js";

/** Error de dominio con código (se mapea a respuesta del cliente). */
export class DomainError extends Error {
  constructor(code, message) {
    super(message ?? code);
    this.code = code;
    this.name = "DomainError";
  }
}

const PG_EXCLUSION_VIOLATION = "23P01";

export async function getTenant(db, tenantId) {
  const r = await db.query("SELECT * FROM tenants WHERE id = $1", [tenantId]);
  return r.rows[0] ?? null;
}

export async function getTenantByPhone(db, whatsappPhone) {
  const r = await db.query("SELECT * FROM tenants WHERE whatsapp_phone = $1", [whatsappPhone]);
  return r.rows[0] ?? null;
}

export async function getActiveServices(db, tenantId) {
  const r = await db.query(
    "SELECT * FROM services WHERE tenant_id = $1 AND active = true ORDER BY name",
    [tenantId],
  );
  return r.rows;
}

export async function getServiceById(db, tenantId, serviceId) {
  const r = await db.query(
    "SELECT * FROM services WHERE tenant_id = $1 AND id = $2 AND active = true",
    [tenantId, serviceId],
  );
  return r.rows[0] ?? null;
}

export async function getAllBusinessHours(db, tenantId) {
  const r = await db.query("SELECT * FROM business_hours WHERE tenant_id = $1", [tenantId]);
  return r.rows;
}

export async function findOrCreateCustomer(db, tenantId, phone, name = null) {
  const found = await db.query(
    "SELECT * FROM customers WHERE tenant_id = $1 AND phone = $2",
    [tenantId, phone],
  );
  if (found.rows[0]) return found.rows[0];
  const created = await db.query(
    "INSERT INTO customers (tenant_id, phone, name) VALUES ($1, $2, $3) RETURNING *",
    [tenantId, phone, name],
  );
  return created.rows[0];
}

/** Carga la sesión por (tenant, customer); la crea vacía si no existe. */
export async function loadSession(db, tenantId, customerId, defaultContext) {
  const found = await db.query(
    "SELECT * FROM sessions WHERE tenant_id = $1 AND customer_id = $2",
    [tenantId, customerId],
  );
  if (found.rows[0]) return found.rows[0];
  const created = await db.query(
    "INSERT INTO sessions (tenant_id, customer_id, context) VALUES ($1, $2, $3) RETURNING *",
    [tenantId, customerId, defaultContext],
  );
  return created.rows[0];
}

export async function saveSession(db, tenantId, customerId, context) {
  await db.query(
    `INSERT INTO sessions (tenant_id, customer_id, context, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (tenant_id, customer_id)
     DO UPDATE SET context = EXCLUDED.context, updated_at = now()`,
    [tenantId, customerId, context],
  );
}

/** Citas CONFIRMED del cliente desde ahora (para cancelar/reagendar). */
export async function findActiveAppointments(db, tenantId, customerId, nowIso) {
  const r = await db.query(
    `SELECT a.*, s.name AS service_name
       FROM appointments a
       JOIN services s ON s.id = a.service_id
      WHERE a.tenant_id = $1 AND a.customer_id = $2
        AND a.status = 'CONFIRMED' AND a.starts_at >= $3
      ORDER BY a.starts_at`,
    [tenantId, customerId, nowIso],
  );
  return r.rows.map((row) => ({ ...row, serviceName: row.service_name }));
}

/**
 * Disponibilidad: business_hours − appointments CONFIRMED. Máximo 3 slots.
 * Lanza SERVICE_NOT_FOUND o NO_AVAILABILITY.
 */
export async function getAvailability(db, { tenantId, serviceId, date, timeZone }) {
  const service = await getServiceById(db, tenantId, serviceId);
  if (!service) throw new DomainError("SERVICE_NOT_FOUND");

  const dow = dayOfWeekForDate(date);
  const bhAll = await getAllBusinessHours(db, tenantId);
  const businessHours = bhAll.filter((b) => b.day_of_week === dow);

  // Citas que podrían cruzar el día (en UTC), con margen de un día.
  const dayStart = localToUtc(date, "00:00", timeZone);
  const dayEnd = addMinutes(dayStart, 24 * 60);
  const apptRes = await db.query(
    `SELECT starts_at, ends_at FROM appointments
      WHERE tenant_id = $1 AND status = 'CONFIRMED'
        AND starts_at < $2 AND ends_at > $3`,
    [tenantId, dayEnd.toISOString(), dayStart.toISOString()],
  );

  const slots = generateSlots({
    date,
    timeZone,
    durationMinutes: service.duration_minutes,
    businessHours,
    appointments: apptRes.rows,
  });

  if (slots.length === 0) throw new DomainError("NO_AVAILABILITY");
  return { availableSlots: slots };
}

/**
 * Crea una cita CONFIRMED de forma atómica (anti-overbooking).
 * Lanza CUSTOMER_NOT_FOUND, SERVICE_NOT_FOUND o SLOT_NOT_AVAILABLE.
 */
export async function createAppointment(db, { tenantId, customerId, serviceId, startsAt }) {
  const cust = await db.query(
    "SELECT id FROM customers WHERE tenant_id = $1 AND id = $2",
    [tenantId, customerId],
  );
  if (!cust.rows[0]) throw new DomainError("CUSTOMER_NOT_FOUND");

  const service = await getServiceById(db, tenantId, serviceId);
  if (!service) throw new DomainError("SERVICE_NOT_FOUND");

  const startsDate = new Date(startsAt);
  const endsDate = addMinutes(startsDate, service.duration_minutes);
  const startsIso = startsDate.toISOString();
  const endsIso = endsDate.toISOString();

  try {
    const r = await db.query(
      `INSERT INTO appointments (tenant_id, customer_id, service_id, starts_at, ends_at, status)
       SELECT $1, $2, $3, $4, $5, 'CONFIRMED'
       WHERE NOT EXISTS (
         SELECT 1 FROM appointments a
          WHERE a.tenant_id = $1 AND a.status = 'CONFIRMED'
            AND a.starts_at < $5 AND a.ends_at > $4
       )
       RETURNING *`,
      [tenantId, customerId, serviceId, startsIso, endsIso],
    );
    if (r.rowCount === 0) throw new DomainError("SLOT_NOT_AVAILABLE");
    return r.rows[0];
  } catch (err) {
    // Carrera: dos inserts pasaron el NOT EXISTS; la EXCLUDE constraint frena uno.
    if (err && err.code === PG_EXCLUSION_VIOLATION) {
      throw new DomainError("SLOT_NOT_AVAILABLE");
    }
    throw err;
  }
}

export async function cancelAppointment(db, { tenantId, customerId, appointmentId }) {
  const found = await db.query(
    "SELECT * FROM appointments WHERE id = $1 AND tenant_id = $2 AND customer_id = $3",
    [appointmentId, tenantId, customerId],
  );
  const appt = found.rows[0];
  if (!appt) throw new DomainError("APPOINTMENT_NOT_FOUND");
  if (appt.status === "CANCELLED") throw new DomainError("APPOINTMENT_ALREADY_CANCELLED");

  const r = await db.query(
    "UPDATE appointments SET status = 'CANCELLED', updated_at = now() WHERE id = $1 RETURNING *",
    [appointmentId],
  );
  return r.rows[0];
}

/**
 * Reagenda actualizando la MISMA cita (no crea una nueva). Atómico.
 * Lanza APPOINTMENT_NOT_FOUND o SLOT_NOT_AVAILABLE.
 */
export async function rescheduleAppointment(db, { tenantId, customerId, appointmentId, newStartsAt }) {
  const found = await db.query(
    `SELECT a.*, s.duration_minutes
       FROM appointments a JOIN services s ON s.id = a.service_id
      WHERE a.id = $1 AND a.tenant_id = $2 AND a.customer_id = $3 AND a.status = 'CONFIRMED'`,
    [appointmentId, tenantId, customerId],
  );
  const appt = found.rows[0];
  if (!appt) throw new DomainError("APPOINTMENT_NOT_FOUND");

  const startsDate = new Date(newStartsAt);
  const endsDate = addMinutes(startsDate, appt.duration_minutes);
  const startsIso = startsDate.toISOString();
  const endsIso = endsDate.toISOString();

  try {
    const r = await db.query(
      `UPDATE appointments
          SET starts_at = $2, ends_at = $3, updated_at = now()
        WHERE id = $1 AND status = 'CONFIRMED'
          AND NOT EXISTS (
            SELECT 1 FROM appointments a
             WHERE a.tenant_id = $4 AND a.id <> $1 AND a.status = 'CONFIRMED'
               AND a.starts_at < $3 AND a.ends_at > $2
          )
        RETURNING *`,
      [appointmentId, startsIso, endsIso, tenantId],
    );
    if (r.rowCount === 0) throw new DomainError("SLOT_NOT_AVAILABLE");
    return r.rows[0];
  } catch (err) {
    if (err && err.code === PG_EXCLUSION_VIOLATION) {
      throw new DomainError("SLOT_NOT_AVAILABLE");
    }
    throw err;
  }
}
