import { describe, it, expect } from "vitest";
import { generateSlots } from "../src/lib/availability.js";

const TZ = "America/Hermosillo";
const BH_MON = [{ start_time: "09:00:00", end_time: "18:00:00" }]; // 16:00Z..01:00Z

describe("generateSlots (business_hours − appointments)", () => {
  it("horario libre: primeros 3 slots desde la apertura", () => {
    const slots = generateSlots({
      date: "2026-06-08",
      timeZone: TZ,
      durationMinutes: 60,
      businessHours: BH_MON,
      appointments: [],
    });
    expect(slots.map((s) => s.startsAt)).toEqual([
      "2026-06-08T16:00:00.000Z",
      "2026-06-08T16:15:00.000Z",
      "2026-06-08T16:30:00.000Z",
    ]);
  });

  it("horario ocupado: excluye solapamiento con cita 16:00-17:00Z", () => {
    const slots = generateSlots({
      date: "2026-06-08",
      timeZone: TZ,
      durationMinutes: 60,
      businessHours: BH_MON,
      appointments: [{ starts_at: "2026-06-08T16:00:00Z", ends_at: "2026-06-08T17:00:00Z" }],
    });
    // El primer hueco para 60 min es 17:00Z.
    expect(slots[0].startsAt).toBe("2026-06-08T17:00:00.000Z");
    expect(slots.some((s) => s.startsAt === "2026-06-08T16:00:00.000Z")).toBe(false);
  });

  it("fuera de business_hours: sin horario ese día devuelve vacío", () => {
    const slots = generateSlots({
      date: "2026-06-07", // domingo, sin BH
      timeZone: TZ,
      durationMinutes: 60,
      businessHours: [],
      appointments: [],
    });
    expect(slots).toEqual([]);
  });

  it("la cita completa debe caber: ningún slot termina tras el cierre", () => {
    const slots = generateSlots({
      date: "2026-06-08",
      timeZone: TZ,
      durationMinutes: 60,
      businessHours: BH_MON,
      appointments: [],
    });
    const close = new Date("2026-06-09T01:00:00Z").getTime();
    for (const s of slots) expect(new Date(s.endsAt).getTime()).toBeLessThanOrEqual(close);
  });

  it("devuelve máximo 3", () => {
    const slots = generateSlots({
      date: "2026-06-08",
      timeZone: TZ,
      durationMinutes: 60,
      businessHours: BH_MON,
      appointments: [],
    });
    expect(slots.length).toBe(3);
  });
});
