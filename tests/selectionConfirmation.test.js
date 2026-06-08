import { describe, it, expect } from "vitest";
import { resolveSelection } from "../src/lib/selection.js";
import { isConfirmation, isRejection } from "../src/lib/confirmation.js";

const offered = [
  { startsAt: "2026-06-08T17:00:00Z", endsAt: "2026-06-08T18:00:00Z" }, // 10:00 local
  { startsAt: "2026-06-08T19:00:00Z", endsAt: "2026-06-08T20:00:00Z" }, // 12:00 local
  { startsAt: "2026-06-08T23:00:00Z", endsAt: "2026-06-09T00:00:00Z" }, // 16:00 local
];
const TZ = "America/Hermosillo";

describe("resolveSelection", () => {
  it("por número de opción", () => {
    expect(resolveSelection("2", offered, TZ)).toBe(offered[1]);
  });
  it("por ordinal", () => {
    expect(resolveSelection("la primera", offered, TZ)).toBe(offered[0]);
  });
  it("por hora local (12 → 12:00 = 19:00Z)", () => {
    expect(resolveSelection("12", offered, TZ)).toBe(offered[1]);
  });
  it("por hora con :00", () => {
    expect(resolveSelection("16:00", offered, TZ)).toBe(offered[2]);
  });
  it("null si no hay match", () => {
    expect(resolveSelection("no sé", offered, TZ)).toBeNull();
  });
});

describe("confirmación / rechazo", () => {
  it("confirma", () => {
    for (const w of ["sí", "si", "ok", "dale", "perfecto", "va", "confirmo"]) {
      expect(isConfirmation(w)).toBe(true);
    }
  });
  it("rechaza", () => {
    for (const w of ["no", "mejor no", "espera", "cancelar"]) {
      expect(isRejection(w)).toBe(true);
    }
  });
});
