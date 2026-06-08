import { describe, it, expect } from "vitest";
import { newContext, applyEntities, determineNextStep, clearContext } from "../src/lib/session.js";
import { EMPTY_ENTITIES } from "../src/lib/llm.js";

const slot = { startsAt: "2026-06-08T17:00:00Z", endsAt: "2026-06-08T18:00:00Z" };

describe("applyEntities (normalización)", () => {
  it("guarda serviceId, fecha y hora normalizadas", () => {
    const ctx = applyEntities(newContext(), {
      ...EMPTY_ENTITIES,
      serviceId: "svc",
      requestedDate: "2026-06-08",
      requestedTime: "16:00",
    });
    expect(ctx.serviceId).toBe("svc");
    expect(ctx.requestedDate).toBe("2026-06-08");
    expect(ctx.requestedTime).toBe("16:00");
  });

  it("ignora fecha mal formada", () => {
    const ctx = applyEntities(newContext(), { ...EMPTY_ENTITIES, requestedDate: "mañana" });
    expect(ctx.requestedDate).toBeNull();
  });
});

describe("determineNextStep — BOOK (orden Documento 2 A2)", () => {
  const base = { flow: "BOOK_APPOINTMENT", customerHasName: false };
  it("pide servicio", () => {
    expect(determineNextStep({ ...base, ctx: { ...newContext() } })).toBe("ASK_SERVICE");
  });
  it("pide fecha", () => {
    expect(determineNextStep({ ...base, ctx: { ...newContext(), serviceId: "s" } })).toBe("ASK_DATE");
  });
  it("muestra disponibilidad", () => {
    expect(
      determineNextStep({ ...base, ctx: { ...newContext(), serviceId: "s", requestedDate: "2026-06-08" } }),
    ).toBe("SHOW_AVAILABILITY");
  });
  it("pide nombre si el cliente no lo tiene", () => {
    expect(
      determineNextStep({
        ...base,
        ctx: { ...newContext(), serviceId: "s", requestedDate: "2026-06-08", selectedSlot: slot },
      }),
    ).toBe("ASK_NAME");
  });
  it("salta nombre si el cliente ya tiene nombre → confirmación", () => {
    expect(
      determineNextStep({
        flow: "BOOK_APPOINTMENT",
        customerHasName: true,
        ctx: { ...newContext(), serviceId: "s", requestedDate: "2026-06-08", selectedSlot: slot },
      }),
    ).toBe("ASK_CONFIRMATION");
  });
  it("ejecuta al confirmar", () => {
    expect(
      determineNextStep({
        flow: "BOOK_APPOINTMENT",
        customerHasName: true,
        ctx: {
          ...newContext(),
          serviceId: "s",
          requestedDate: "2026-06-08",
          selectedSlot: slot,
          awaitingConfirmation: true,
        },
      }),
    ).toBe("EXECUTE_CREATE");
  });
});

describe("clearContext", () => {
  it("conserva processedMessageIds", () => {
    const ctx = { ...newContext(), serviceId: "s", processedMessageIds: ["a", "b"] };
    const cleared = clearContext(ctx);
    expect(cleared.serviceId).toBeNull();
    expect(cleared.processedMessageIds).toEqual(["a", "b"]);
  });
});
