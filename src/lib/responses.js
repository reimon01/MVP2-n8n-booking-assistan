/**
 * Plantillas de respuesta en español (Documento 2).
 */
import { localDateTimeLabel, localTimeInTz } from "./time.js";

export function askService(services) {
  const names = services.map((s) => s.name).join(", ");
  return `¿Qué servicio te gustaría agendar?\nTenemos: ${names}.`;
}

export function askDate() {
  return "¿Qué día te gustaría venir?";
}

export function askName() {
  return "¿A nombre de quién registro la cita?";
}

export function showAvailability(slots, timeZone) {
  const lines = slots.map((s, i) => `${i + 1}) ${localTimeInTz(new Date(s.startsAt), timeZone)}`);
  return `Tengo estos horarios disponibles:\n${lines.join("\n")}\n¿Cuál prefieres?`;
}

export function noAvailability() {
  return "No encontré horarios disponibles ese día. ¿Quieres que revise otro día?";
}

export function slotTaken() {
  return "Ese horario ya no está disponible. Te muestro otras opciones.";
}

export function confirmBooking(serviceName, slot, timeZone) {
  return `Confirmo tu cita para ${serviceName} el ${localDateTimeLabel(
    new Date(slot.startsAt),
    timeZone,
  )}. ¿Está bien?`;
}

export function bookingCreated(serviceName, slot, timeZone) {
  return `Listo, tu cita quedó agendada para ${serviceName} el ${localDateTimeLabel(
    new Date(slot.startsAt),
    timeZone,
  )}.`;
}

export function bookingRejected() {
  return "Sin problema. No agendé la cita.";
}

export function noActiveAppointments() {
  return "No encontré citas activas a tu nombre.";
}

export function noActiveToReschedule() {
  return "No encontré citas activas para reagendar.";
}

export function confirmCancel(serviceName, startsAtIso, timeZone) {
  return `Tienes una cita de ${serviceName} el ${localDateTimeLabel(
    new Date(startsAtIso),
    timeZone,
  )}. ¿Quieres cancelarla?`;
}

export function cancelled() {
  return "Listo, tu cita fue cancelada.";
}

export function askWhichAppointment(appts, timeZone, verb) {
  const lines = appts.map(
    (a, i) => `${i + 1}) ${a.serviceName} — ${localDateTimeLabel(new Date(a.starts_at), timeZone)}`,
  );
  return `Encontré estas citas:\n${lines.join("\n")}\n¿Cuál quieres ${verb}?`;
}

export function askNewDate() {
  return "¿Qué nuevo día te gustaría?";
}

export function confirmReschedule(slot, timeZone) {
  return `Confirmo el cambio de tu cita al ${localDateTimeLabel(
    new Date(slot.startsAt),
    timeZone,
  )}. ¿Está bien?`;
}

export function rescheduled() {
  return "Listo, tu cita fue reagendada.";
}

export function fallback() {
  return "¿Me ayudas con un poco más de detalle? Puedo agendar, cancelar o reagendar tu cita, o darte información de servicios, precios, horario y ubicación.";
}

// ---- FAQ ----
export function faqServices(services) {
  const list = services.map((s) => `- ${s.name}`).join("\n");
  return `Estos son nuestros servicios:\n${list}`;
}

export function faqPrices(services) {
  const list = services.map((s) => `${s.name}: $${Number(s.price).toFixed(0)}`).join("\n");
  return `Precios:\n${list}`;
}

export function faqBusinessHours(hours) {
  const days = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  const sorted = [...hours].sort((a, b) => a.day_of_week - b.day_of_week);
  const list = sorted
    .map((h) => `${days[h.day_of_week]}: ${String(h.start_time).slice(0, 5)} - ${String(h.end_time).slice(0, 5)}`)
    .join("\n");
  return `Nuestro horario:\n${list}`;
}

export function faqLocation(tenant) {
  if (tenant.address) return `Estamos en: ${tenant.address}`;
  return `Somos ${tenant.name}. Pronto te compartimos la ubicación exacta.`;
}
