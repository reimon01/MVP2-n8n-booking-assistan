/**
 * Orquestador del flujo de reservas v2.0.
 *
 * Replica, en un solo módulo testeable, lo que en producción hacen los nodos
 * del workflow de n8n (Documento 2). Sirve como fuente de verdad para los
 * Code nodes y como base de los tests E2E.
 *
 *   WhatsApp → idempotencia → cliente → sesión → LLM → ramas A-D → respuesta
 */
import {
  getTenant,
  getActiveServices,
  getAllBusinessHours,
  findOrCreateCustomer,
  loadSession,
  saveSession,
  findActiveAppointments,
  getAvailability,
  createAppointment,
  cancelAppointment,
  rescheduleAppointment,
  DomainError,
} from "./dbOps.js";
import { newContext, applyEntities, determineNextStep, clearContext } from "./session.js";
import { buildLlmInput } from "./llm.js";
import { isConfirmation, isRejection } from "./confirmation.js";
import { resolveSelection } from "./selection.js";
import * as R from "./responses.js";

const FLOW_INTENTS = ["BOOK_APPOINTMENT", "CANCEL_APPOINTMENT", "RESCHEDULE_APPOINTMENT"];
const FAQ_INTENTS = ["ASK_SERVICES", "ASK_PRICES", "ASK_BUSINESS_HOURS", "ASK_LOCATION"];
const MAX_PROCESSED_IDS = 50;

/**
 * @param {import('pg').Pool} db
 * @param {{tenantId:string,phone:string,messageText:string,messageId:string,receivedAt:string}} msg
 * @param {{ llm: { extract(input:object): Promise<object> } }} deps
 * @returns {Promise<{reply:string, duplicate?:boolean}>}
 */
export async function processInbound(db, msg, deps) {
  const tenant = await getTenant(db, msg.tenantId);
  if (!tenant) throw new DomainError("TENANT_NOT_FOUND");

  const customer = await findOrCreateCustomer(db, msg.tenantId, msg.phone);

  const sessionRow = await loadSession(db, msg.tenantId, customer.id, newContext());
  let ctx = normalizeCtx(sessionRow.context);

  // --- Paso 1: idempotencia (Documento 2) ---
  if (ctx.processedMessageIds.includes(msg.messageId)) {
    return { reply: "", duplicate: true };
  }
  ctx.processedMessageIds.push(msg.messageId);
  if (ctx.processedMessageIds.length > MAX_PROCESSED_IDS) {
    ctx.processedMessageIds = ctx.processedMessageIds.slice(-MAX_PROCESSED_IDS);
  }

  const services = await getActiveServices(db, msg.tenantId);

  // Guarda la sesión actual y devuelve la respuesta.
  const respond = async (text) => {
    await saveSession(db, msg.tenantId, customer.id, ctx);
    return { reply: text };
  };

  // --- Paso 4: LLM ---
  const llmInput = buildLlmInput({
    tenant,
    services,
    session: ctx,
    messageText: msg.messageText,
    receivedAt: msg.receivedAt,
  });
  let llm;
  try {
    llm = await deps.llm.extract(llmInput);
  } catch {
    llm = { intent: "UNKNOWN", entities: {} };
  }
  const intent = llm.intent ?? "UNKNOWN";
  const entities = llm.entities ?? {};

  // --- Confirmación pendiente ---
  let confirmedNow = false;
  if (ctx.awaitingConfirmation) {
    const confirmed =
      intent === "CONFIRM" || entities.confirmation === "YES" || isConfirmation(msg.messageText);
    const rejected =
      intent === "REJECT" || entities.confirmation === "NO" || isRejection(msg.messageText);
    if (rejected) {
      const wasCreate = ctx.pendingAction === "CREATE_APPOINTMENT";
      ctx = clearContext(ctx);
      return respond(wasCreate ? R.bookingRejected() : "De acuerdo, no hice cambios.");
    }
    if (!confirmed) {
      return respond("¿Confirmas? Responde sí o no, por favor.");
    }
    confirmedNow = true; // se ejecutará abajo vía determineNextStep
  }

  // --- Transición de flujo (si no venimos de una confirmación) ---
  let flow = ctx.intent;
  if (!confirmedNow) {
    if (FLOW_INTENTS.includes(intent)) {
      if (intent !== ctx.intent) {
        ctx = clearContext(ctx);
        ctx.intent = intent;
      }
      flow = intent;
    } else if (FAQ_INTENTS.includes(intent)) {
      return respond(await answerFaq(db, tenant, services, intent));
    } else if (!ctx.intent) {
      return respond(R.fallback());
    }
    // intent CONFIRM/REJECT/UNKNOWN con flujo existente: se continúa el flujo.
  }

  // --- Actualizar contexto con entidades ---
  ctx = applyEntities(ctx, entities);

  // --- Resolver cita para CANCEL/RESCHEDULE ---
  if ((flow === "CANCEL_APPOINTMENT" || flow === "RESCHEDULE_APPOINTMENT") && !confirmedNow) {
    const res = await resolveAppointment(db, ctx, msg, tenant, flow, customer.id);
    if (res.reply) {
      if (res.clear) ctx = clearContext(ctx);
      return respond(res.reply);
    }
  }

  // --- Resolver selección de horario ofrecido ---
  if (!confirmedNow && ctx.offeredSlots?.length && !ctx.selectedSlot) {
    const chosen = resolveSelection(msg.messageText, ctx.offeredSlots, tenant.timezone);
    if (chosen) {
      ctx.selectedSlot = chosen;
      ctx.offeredSlots = [];
    }
  }

  // --- Decidir y ejecutar ---
  const customerHasName = Boolean(customer.name && customer.name.trim());
  const action = determineNextStep({ flow, ctx, customerHasName });

  return runAction({ db, msg, tenant, services, customer, ctx, flow, action, respond });
}

// ---------------------------------------------------------------------------

function normalizeCtx(raw) {
  const base = newContext();
  const ctx = { ...base, ...(raw ?? {}) };
  if (!Array.isArray(ctx.processedMessageIds)) ctx.processedMessageIds = [];
  if (!Array.isArray(ctx.offeredSlots)) ctx.offeredSlots = [];
  return ctx;
}

async function answerFaq(db, tenant, services, intent) {
  switch (intent) {
    case "ASK_SERVICES":
      return R.faqServices(services);
    case "ASK_PRICES":
      return R.faqPrices(services);
    case "ASK_BUSINESS_HOURS":
      return R.faqBusinessHours(await getAllBusinessHours(db, tenant.id));
    case "ASK_LOCATION":
      return R.faqLocation(tenant);
    default:
      return R.fallback();
  }
}

/**
 * Resuelve qué cita usar (0/1/varias). Devuelve {reply, clear?} para
 * cortar el turno, o {} si ya quedó resuelto el appointmentId.
 */
async function resolveAppointment(db, ctx, msg, tenant, flow, customerId) {
  if (ctx.appointmentId) return {};
  const verb = flow === "CANCEL_APPOINTMENT" ? "cancelar" : "cambiar";

  // Si ya ofrecimos opciones, intentar resolver por número.
  if (ctx.offeredAppointments?.length) {
    const m = msg.messageText.match(/\b([1-9])\b/);
    if (m) {
      const idx = Number(m[1]) - 1;
      const pick = ctx.offeredAppointments[idx];
      if (pick) {
        setAppointment(ctx, pick);
        return {};
      }
    }
    return { reply: R.askWhichAppointment(ctx.offeredAppointments, tenant.timezone, verb) };
  }

  const list = await findActiveAppointments(db, tenant.id, customerId, msg.receivedAt);

  if (list.length === 0) {
    return {
      reply: flow === "CANCEL_APPOINTMENT" ? R.noActiveAppointments() : R.noActiveToReschedule(),
      clear: true,
    };
  }
  if (list.length === 1) {
    setAppointment(ctx, normalizeAppt(list[0]));
    return {};
  }
  ctx.offeredAppointments = list.map(normalizeAppt);
  return { reply: R.askWhichAppointment(ctx.offeredAppointments, tenant.timezone, verb) };
}

function normalizeAppt(a) {
  return {
    id: a.id,
    serviceName: a.serviceName ?? a.service_name,
    starts_at: a.starts_at instanceof Date ? a.starts_at.toISOString() : a.starts_at,
    service_id: a.service_id,
  };
}

function setAppointment(ctx, pick) {
  ctx.appointmentId = pick.id;
  ctx.cancelServiceName = pick.serviceName;
  ctx.cancelStartsAt = pick.starts_at;
  ctx.rescheduleServiceId = pick.service_id;
  ctx.offeredAppointments = [];
}

async function runAction({ db, msg, tenant, services, customer, ctx, flow, action, respond }) {
  const tz = tenant.timezone;
  switch (action) {
    case "ASK_SERVICE":
      return respond(R.askService(services));

    case "ASK_DATE":
      return respond(flow === "RESCHEDULE_APPOINTMENT" ? R.askNewDate() : R.askDate());

    case "ASK_NAME":
      return respond(R.askName());

    case "SHOW_AVAILABILITY": {
      const serviceId = flow === "RESCHEDULE_APPOINTMENT" ? rescheduleServiceId(ctx) : ctx.serviceId;
      try {
        const { availableSlots } = await getAvailability(db, {
          tenantId: tenant.id,
          serviceId,
          date: ctx.requestedDate,
          timeZone: tz,
        });
        ctx.offeredSlots = availableSlots;
        return respond(R.showAvailability(availableSlots, tz));
      } catch (err) {
        if (err instanceof DomainError && err.code === "NO_AVAILABILITY") {
          ctx.requestedDate = null;
          return respond(R.noAvailability());
        }
        throw err;
      }
    }

    case "ASK_CONFIRMATION": {
      ctx.awaitingConfirmation = true;
      if (flow === "BOOK_APPOINTMENT") {
        ctx.pendingAction = "CREATE_APPOINTMENT";
        const svc = services.find((s) => s.id === ctx.serviceId);
        return respond(R.confirmBooking(svc?.name ?? "tu servicio", ctx.selectedSlot, tz));
      }
      if (flow === "CANCEL_APPOINTMENT") {
        ctx.pendingAction = "CANCEL_APPOINTMENT";
        return respond(R.confirmCancel(ctx.cancelServiceName ?? "tu servicio", ctx.cancelStartsAt, tz));
      }
      ctx.pendingAction = "RESCHEDULE_APPOINTMENT";
      return respond(R.confirmReschedule(ctx.selectedSlot, tz));
    }

    case "EXECUTE_CREATE": {
      try {
        await createAppointment(db, {
          tenantId: tenant.id,
          customerId: customer.id,
          serviceId: ctx.serviceId,
          startsAt: ctx.selectedSlot.startsAt,
        });
        const svc = services.find((s) => s.id === ctx.serviceId);
        const slot = ctx.selectedSlot;
        const reset = clearContext(ctx);
        Object.assign(ctx, reset);
        return respond(R.bookingCreated(svc?.name ?? "tu servicio", slot, tz));
      } catch (err) {
        return handleExecuteError(err, ctx, respond);
      }
    }

    case "EXECUTE_CANCEL": {
      await cancelAppointment(db, {
        tenantId: tenant.id,
        customerId: customer.id,
        appointmentId: ctx.appointmentId,
      });
      Object.assign(ctx, clearContext(ctx));
      return respond(R.cancelled());
    }

    case "EXECUTE_RESCHEDULE": {
      try {
        await rescheduleAppointment(db, {
          tenantId: tenant.id,
          customerId: customer.id,
          appointmentId: ctx.appointmentId,
          newStartsAt: ctx.selectedSlot.startsAt,
        });
        Object.assign(ctx, clearContext(ctx));
        return respond(R.rescheduled());
      } catch (err) {
        return handleExecuteError(err, ctx, respond);
      }
    }

    case "ASK_CLARIFICATION":
    default:
      return respond(R.fallback());
  }
}

function rescheduleServiceId(ctx) {
  return ctx.rescheduleServiceId ?? ctx.serviceId;
}

function handleExecuteError(err, ctx, respond) {
  if (err instanceof DomainError && err.code === "SLOT_NOT_AVAILABLE") {
    ctx.selectedSlot = null;
    ctx.offeredSlots = [];
    ctx.awaitingConfirmation = false;
    ctx.pendingAction = null;
    return respond(R.slotTaken());
  }
  throw err;
}
