/**
 * Generación de slots disponibles (pura, sin DB).
 *
 * Disponibilidad = business_hours − appointments CONFIRMED  (Documento 1/2/3).
 * Sin staff (conflicto a nivel de tenant) y sin availability_blocks.
 *
 * Pensada para vivir en un Code node de n8n: recibe las filas ya leídas por
 * nodos Postgres y devuelve hasta 3 horarios.
 */
import { addMinutes, localToUtc, dayOfWeekOfDate, rangesOverlap, slotStepMinutes } from "./time.js";

const MAX_SLOTS = 3;

function hm(timeStr) {
  return String(timeStr).slice(0, 5); // "HH:mm:ss" -> "HH:mm"
}

/**
 * @param {object} p
 * @param {string} p.date            "YYYY-MM-DD" (local del tenant)
 * @param {string} p.timeZone        IANA tz del tenant
 * @param {number} p.durationMinutes duración del servicio
 * @param {{start_time:string,end_time:string}[]} p.businessHours filas del día
 * @param {{starts_at:string|Date,ends_at:string|Date}[]} p.appointments CONFIRMED que cruzan el día
 * @returns {{startsAt:string,endsAt:string}[]} hasta 3 slots (ISO UTC)
 */
export function generateSlots(p) {
  const { date, timeZone, durationMinutes, businessHours, appointments } = p;
  if (!businessHours || businessHours.length === 0) return [];

  const busy = (appointments ?? []).map((a) => ({
    start: a.starts_at instanceof Date ? a.starts_at : new Date(a.starts_at),
    end: a.ends_at instanceof Date ? a.ends_at : new Date(a.ends_at),
  }));

  const step = slotStepMinutes();
  const out = [];

  for (const bh of businessHours) {
    const windowStart = localToUtc(date, hm(bh.start_time), timeZone);
    const windowEnd = localToUtc(date, hm(bh.end_time), timeZone);

    let cursor = windowStart;
    while (true) {
      const endsAt = addMinutes(cursor, durationMinutes);
      if (endsAt > windowEnd) break; // la cita completa ya no cabe
      const conflict = busy.some((b) => rangesOverlap(cursor, endsAt, b.start, b.end));
      if (!conflict) {
        out.push({ startsAt: cursor.toISOString(), endsAt: endsAt.toISOString() });
        if (out.length >= MAX_SLOTS) return out;
      }
      cursor = addMinutes(cursor, step);
    }
  }
  return out;
}

/** Valida que la fecha sea día laboral (devuelve el dow). */
export function dayOfWeekForDate(date) {
  return dayOfWeekOfDate(date);
}
