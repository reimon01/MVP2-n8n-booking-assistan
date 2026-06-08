import { describe, it, expect } from "vitest";
import { localToUtc, addMinutes, localTimeInTz, dayOfWeekOfDate, rangesOverlap } from "../src/lib/time.js";

describe("time utils v2", () => {
  it("local Hermosillo (UTC-7) → UTC", () => {
    expect(localToUtc("2026-06-08", "16:00", "America/Hermosillo").toISOString()).toBe(
      "2026-06-08T23:00:00.000Z",
    );
    expect(localToUtc("2026-06-08", "09:00", "America/Hermosillo").toISOString()).toBe(
      "2026-06-08T16:00:00.000Z",
    );
  });

  it("UTC → hora local", () => {
    expect(localTimeInTz(new Date("2026-06-08T16:00:00Z"), "America/Hermosillo")).toBe("09:00");
  });

  it("addMinutes", () => {
    expect(addMinutes(new Date("2026-06-08T16:00:00Z"), 90).toISOString()).toBe(
      "2026-06-08T17:30:00.000Z",
    );
  });

  it("dayOfWeekOfDate", () => {
    expect(dayOfWeekOfDate("2026-06-08")).toBe(1); // lunes
    expect(dayOfWeekOfDate("2024-01-07")).toBe(0); // domingo
  });

  it("rangesOverlap respeta bordes", () => {
    const a = [new Date("2026-06-08T16:00:00Z"), new Date("2026-06-08T17:00:00Z")];
    expect(rangesOverlap(a[0], a[1], new Date("2026-06-08T16:30:00Z"), new Date("2026-06-08T17:30:00Z"))).toBe(true);
    expect(rangesOverlap(a[0], a[1], new Date("2026-06-08T17:00:00Z"), new Date("2026-06-08T18:00:00Z"))).toBe(false);
  });
});
