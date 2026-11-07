import { describe, expect, it } from "vitest";
import { datumBerlin, heuteBerlin, tageAddieren } from "./datum";

// Bus #191: kein Tagesversatz mehr bei „sofort zahlbar" — Europe/Berlin statt UTC
describe("Kalenderdatum Europe/Berlin (#191)", () => {
  it("UTC-Mitternacht ist in Berlin schon heute, nicht gestern", () => {
    // 14.08.2026 22:30 UTC = 15.08.2026 00:30 in Berlin (Sommerzeit)
    expect(datumBerlin(new Date("2026-08-14T22:30:00Z"))).toBe("2026-08-15");
    // 14.08.2026 23:30 UTC = 15.08.2026 01:30 in Berlin (Winterzeit wäre +1)
    expect(datumBerlin(new Date("2026-01-14T23:30:00Z"))).toBe("2026-01-15");
  });

  it("heuteBerlin liefert JJJJ-MM-TT", () => {
    expect(heuteBerlin()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("tageAddieren: 0 Tage = identisches Datum („sofort zahlbar“)", () => {
    expect(tageAddieren("2026-08-14", 0)).toBe("2026-08-14");
    expect(tageAddieren("2026-01-01", 0)).toBe("2026-01-01");
  });

  it("tageAddieren ist DST-sicher (Sommer-/Winterzeit-Wechsel)", () => {
    // 29.03.2026 Sommerzeit, 25.10.2026 Winterzeit (Berlin)
    expect(tageAddieren("2026-03-28", 2)).toBe("2026-03-30");
    expect(tageAddieren("2026-03-29", 1)).toBe("2026-03-30");
    expect(tageAddieren("2026-10-24", 2)).toBe("2026-10-26");
    expect(tageAddieren("2026-10-25", 1)).toBe("2026-10-26");
    // Monats-/Jahresgrenzen
    expect(tageAddieren("2026-12-31", 1)).toBe("2027-01-01");
    expect(tageAddieren("2026-08-14", 14)).toBe("2026-08-28");
    // Schaltjahr
    expect(tageAddieren("2028-02-28", 1)).toBe("2028-02-29");
  });
});
