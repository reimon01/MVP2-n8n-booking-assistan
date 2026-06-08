import { describe, it, expect } from "vitest";
import { parseLlmOutput, buildLlmInput } from "../src/lib/llm.js";

describe("parseLlmOutput (validación estricta Documento 3 §10)", () => {
  const valid = {
    intent: "BOOK_APPOINTMENT",
    entities: {
      serviceId: "svc",
      serviceName: "Manicure",
      requestedDate: "2026-06-08",
      requestedTime: "16:00",
      customerName: null,
      confirmation: null,
    },
  };

  it("acepta output válido", () => {
    expect(parseLlmOutput(JSON.stringify(valid)).intent).toBe("BOOK_APPOINTMENT");
  });
  it("UNKNOWN si JSON inválido", () => {
    expect(parseLlmOutput("nope").intent).toBe("UNKNOWN");
  });
  it("UNKNOWN si falta entities", () => {
    expect(parseLlmOutput(JSON.stringify({ intent: "BOOK_APPOINTMENT" })).intent).toBe("UNKNOWN");
  });
  it("UNKNOWN si intent fuera del enum", () => {
    expect(parseLlmOutput(JSON.stringify({ ...valid, intent: "DROP_DB" })).intent).toBe("UNKNOWN");
  });
  it("tolera code fences", () => {
    expect(parseLlmOutput("```json\n" + JSON.stringify(valid) + "\n```").intent).toBe(
      "BOOK_APPOINTMENT",
    );
  });
});

describe("buildLlmInput", () => {
  it("incluye catálogo con precio y duración", () => {
    const input = buildLlmInput({
      tenant: { id: "t", timezone: "America/Hermosillo" },
      services: [{ id: "s", name: "Manicure", price: "350.00", duration_minutes: 60 }],
      session: {},
      messageText: "hola",
      receivedAt: "2026-06-07T18:00:00Z",
    });
    expect(input.catalog.services[0]).toEqual({
      id: "s",
      name: "Manicure",
      price: 350,
      durationMinutes: 60,
    });
    expect(input.message.text).toBe("hola");
  });
});
