/**
 * Utilidades de tiempo (v2.0).
 * Persistencia en UTC; interpretación/visualización con tenant.timezone.
 */

const MS_PER_MINUTE = 60_000;
const SLOT_STEP_MINUTES = 15;

export function slotStepMinutes() {
  return SLOT_STEP_MINUTES;
}

export function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * MS_PER_MINUTE);
}

/** Offset (ms) de una IANA timezone respecto a UTC para un instante. */
export function timezoneOffsetMs(utc, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(utc);
  const map = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = Number(p.value);
  const asUtc = Date.UTC(
    map.year,
    map.month - 1,
    map.day,
    map.hour === 24 ? 0 : map.hour,
    map.minute,
    map.second,
  );
  return asUtc - utc.getTime();
}

/** Convierte fecha/hora local (YYYY-MM-DD, HH:mm) en tenantTz a instante UTC. */
export function localToUtc(dateYmd, timeHm, timeZone) {
  const [y, mo, d] = dateYmd.split("-").map(Number);
  const [h, mi] = timeHm.split(":").map(Number);
  const naiveUtc = Date.UTC(y, mo - 1, d, h, mi, 0);
  const offset = timezoneOffsetMs(new Date(naiveUtc), timeZone);
  return new Date(naiveUtc - offset);
}

/** "YYYY-MM-DD" del instante UTC visto en la timezone del tenant. */
export function localDateInTz(utc, timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(utc);
}

/** "HH:mm" del instante UTC visto en la timezone del tenant. */
export function localTimeInTz(utc, timeZone) {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(utc);
}

/** Etiqueta legible, ej. "lunes 8 de junio a las 16:00". */
export function localDateTimeLabel(utc, timeZone) {
  const date = new Intl.DateTimeFormat("es-MX", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(utc);
  return `${date} a las ${localTimeInTz(utc, timeZone)}`;
}

/** Día de la semana (0=Dom..6=Sáb) de una fecha calendario "YYYY-MM-DD". */
export function dayOfWeekOfDate(dateYmd) {
  const [y, m, d] = dateYmd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** [aStart,aEnd) solapa [bStart,bEnd). */
export function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}
