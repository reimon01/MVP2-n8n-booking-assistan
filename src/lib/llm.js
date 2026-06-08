/**
 * Contrato del LLM v2.0 (Documento 3 §6-§11).
 * El LLM solo detecta intención y extrae/normaliza entidades. Todo su output
 * se valida; si no cumple, se degrada a UNKNOWN.
 */
import { z } from "zod";

export const INTENTS = [
  "BOOK_APPOINTMENT",
  "CANCEL_APPOINTMENT",
  "RESCHEDULE_APPOINTMENT",
  "ASK_SERVICES",
  "ASK_PRICES",
  "ASK_BUSINESS_HOURS",
  "ASK_LOCATION",
  "CONFIRM",
  "REJECT",
  "UNKNOWN",
];

const EntitiesSchema = z
  .object({
    serviceId: z.string().nullable(),
    serviceName: z.string().nullable(),
    requestedDate: z.string().nullable(),
    requestedTime: z.string().nullable(),
    customerName: z.string().nullable(),
    confirmation: z.enum(["YES", "NO"]).nullable(),
  })
  .strict();

export const OutputSchema = z
  .object({
    intent: z.enum(INTENTS),
    entities: EntitiesSchema,
  })
  .strict();

export const EMPTY_ENTITIES = {
  serviceId: null,
  serviceName: null,
  requestedDate: null,
  requestedTime: null,
  customerName: null,
  confirmation: null,
};

export const UNKNOWN_OUTPUT = { intent: "UNKNOWN", entities: { ...EMPTY_ENTITIES } };

/** System prompt para el nodo del LLM en n8n. */
export const SYSTEM_PROMPT = `Eres un extractor de intención y entidades para un asistente de reservas de un salón de belleza por WhatsApp.

Tu ÚNICA tarea: (1) detectar la intención y (2) extraer/normalizar entidades.
Responde SIEMPRE y SOLO con JSON válido que cumpla el esquema. Sin markdown, sin explicaciones, sin texto extra.

Reglas:
- Usa únicamente servicios presentes en catalog.services. Si no hay match claro: serviceId=null y serviceName con el texto detectado.
- Normaliza fechas relativas (ej. "mañana") a "YYYY-MM-DD" usando tenant.timezone y message.receivedAt.
- Normaliza horas a "HH:mm" (24h). Rangos vagos ("en la tarde") => requestedTime=null.
- Si session.awaitingConfirmation=true y el mensaje es afirmativo (sí, ok, dale, perfecto, va, confirmo) => intent=CONFIRM, confirmation="YES".
- Si session.awaitingConfirmation=true y el mensaje es negativo (no, mejor no, espera, cancelar) => intent=REJECT, confirmation="NO".
- Si no entiendes, intent=UNKNOWN.
- NUNCA inventes servicios, precios, horarios ni disponibilidad. NUNCA crees/cancelas/reagendas citas.`;

/** Construye el input para el LLM (Documento 3 §7). */
export function buildLlmInput({ tenant, services, session, messageText, receivedAt }) {
  return {
    tenant: { id: tenant.id, timezone: tenant.timezone },
    catalog: {
      services: services.map((s) => ({
        id: s.id,
        name: s.name,
        price: Number(s.price),
        durationMinutes: s.duration_minutes,
      })),
    },
    session: {
      intent: session.intent ?? null,
      serviceId: session.serviceId ?? null,
      requestedDate: session.requestedDate ?? null,
      requestedTime: session.requestedTime ?? null,
      awaitingConfirmation: session.awaitingConfirmation ?? false,
      pendingAction: session.pendingAction ?? null,
    },
    message: { text: messageText, receivedAt },
  };
}

/** Quita ```json ... ``` si el modelo lo añadió. */
function stripFences(raw) {
  const t = String(raw).trim();
  if (t.startsWith("```")) {
    return t.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  }
  return t;
}

/** Parsea y valida el output del LLM; UNKNOWN si es inválido. */
export function parseLlmOutput(raw) {
  let json;
  try {
    json = JSON.parse(stripFences(raw));
  } catch {
    return { ...UNKNOWN_OUTPUT };
  }
  const result = OutputSchema.safeParse(json);
  if (!result.success) return { ...UNKNOWN_OUTPUT };
  return result.data;
}
