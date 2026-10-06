import { describe, expect, it } from "vitest";
import { computeTotals } from "./invoicing";

describe("computeTotals — negative Positionen (Anzahlungs-/Vorkassen-Abzug, #120)", () => {
  it("saldiert negative Einzelpreise statt sie auf 0 zu klemmen", () => {
    const t = computeTotals([
      { einzelpreis: "2453.21", menge: 1, ustSatz: 19 },
      { einzelpreis: "-2000.00", menge: 1, ustSatz: 19 }, // Abzug Vorkasse
    ]);
    expect(t.nettoCent).toBe(45321); // 2453.21 - 2000 = 453.21
    expect(t.zeilenNettoCent[1]).toBe(-200000); // die Negativzeile bleibt erhalten
    expect(t.ustProSatz[0].basisCent).toBe(45321);
    expect(t.bruttoCent).toBe(t.nettoCent + t.ustCent);
  });

  it("Gesamt-Brutto darf bei überwiegender Anzahlung auch negativ werden (Gutschrift-in-Rechnung)", () => {
    const t = computeTotals([
      { einzelpreis: "100.00", menge: 1, ustSatz: 19 },
      { einzelpreis: "-300.00", menge: 1, ustSatz: 19 },
    ]);
    expect(t.nettoCent).toBe(-20000);
    expect(t.ustCent).toBeLessThan(0);
  });

  it("Rabatt auf negativer Zeile ergibt keinen negativen Rabatt", () => {
    const t = computeTotals([
      { einzelpreis: "-100.00", menge: 1, ustSatz: 19, rabattArt: "prozent", rabattWert: "10" },
    ]);
    expect(t.zeilenRabattCent[0]).toBe(0);
    expect(t.nettoCent).toBe(-10000);
  });

  it("positive Zeilen bleiben unverändert (Regression)", () => {
    const t = computeTotals([{ einzelpreis: "100.00", menge: 2, ustSatz: 19 }]);
    expect(t.nettoCent).toBe(20000);
    expect(t.ustCent).toBe(3800);
    expect(t.bruttoCent).toBe(23800);
  });
});
