/**
 * Contexto de sesión y decisión de siguiente paso (Documento 2 §A2, Documento 3 §5).
 * Pura: no toca la base de datos.
 */

/** Contexto inicial de una sesión nueva. */
export function newContext() {
  return {
    intent: null,
    serviceId: null,
    requestedDate: null,
    requestedTime: null,
    selectedSlot: null,
    offeredSlots: [],
    customerName: null,
    awaitingConfirmation: false,
    pendingAction: null,
    appointmentId: null,
    processedMessageIds: [],
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

/**
 * Fusiona entidades normalizadas del LLM en el contexto (no guarda texto crudo).
 * @param {object} ctx
 * @param {object} entities  entidades validadas del LLM
 * @returns {object} nuevo contexto
 */
export function applyEntities(ctx, entities) {
  const next = { ...ctx };
  if (entities.serviceId) next.serviceId = entities.serviceId;
  if (entities.requestedDate && DATE_RE.test(entities.requestedDate)) {
    next.requestedDate = entities.requestedDate;
  }
  if (entities.requestedTime && TIME_RE.test(entities.requestedTime)) {
    next.requestedTime = entities.requestedTime;
  }
  if (entities.customerName) next.customerName = entities.customerName;
  return next;
}

/**
 * Decide la siguiente acción para los flujos que recopilan datos.
 * @returns {"ASK_SERVICE"|"ASK_DATE"|"SHOW_AVAILABILITY"|"ASK_NAME"|"ASK_CONFIRMATION"|"EXECUTE_CREATE"|"EXECUTE_CANCEL"|"EXECUTE_RESCHEDULE"|"ASK_CLARIFICATION"}
 */
export function determineNextStep({ flow, ctx, customerHasName }) {
  switch (flow) {
    case "BOOK_APPOINTMENT": {
      if (!ctx.serviceId) return "ASK_SERVICE";
      if (!ctx.requestedDate) return "ASK_DATE";
      if (!ctx.selectedSlot) return "SHOW_AVAILABILITY";
      if (!customerHasName && !ctx.customerName) return "ASK_NAME";
      if (ctx.awaitingConfirmation) return "EXECUTE_CREATE";
      return "ASK_CONFIRMATION";
    }
    case "CANCEL_APPOINTMENT": {
      if (!ctx.appointmentId) return "ASK_CLARIFICATION";
      if (ctx.awaitingConfirmation) return "EXECUTE_CANCEL";
      return "ASK_CONFIRMATION";
    }
    case "RESCHEDULE_APPOINTMENT": {
      if (!ctx.appointmentId) return "ASK_CLARIFICATION";
      if (!ctx.requestedDate) return "ASK_DATE";
      if (!ctx.selectedSlot) return "SHOW_AVAILABILITY";
      if (ctx.awaitingConfirmation) return "EXECUTE_RESCHEDULE";
      return "ASK_CONFIRMATION";
    }
    default:
      return "ASK_CLARIFICATION";
  }
}

/** Limpia el contexto tras completar/abortar un flujo (mantiene idempotencia). */
export function clearContext(ctx) {
  const fresh = newContext();
  fresh.processedMessageIds = ctx.processedMessageIds ?? [];
  return fresh;
}
