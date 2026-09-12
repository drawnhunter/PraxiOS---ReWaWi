import { describe, expect, it } from "vitest";
import { parseSumUpBerichtZeilen } from "./bankTransaktionenRouter";

// Schlankes SumUp-Format (5 Spalten, synthetische Daten)
const ROWS = [
  { "Datum der Transaktion": "2026-08-21", "Transaktions-ID": "C9XQG5YB27", "Referenz": "Avis Budget           OBERURSEL/TS    DE", "Betrag": "-420.84", "Verfügbares Guthaben": "1010.38" },
  { "Datum der Transaktion": "2026-08-21", "Transaktions-ID": "CDJQLZ4576", "Referenz": "Muster GmbH IE10SUMU99036599999999", "Betrag": "470.00", "Verfügbares Guthaben": "1431.22" },
  { "Datum der Transaktion": "kaputt", "Transaktions-ID": "CX00000000", "Referenz": "x", "Betrag": "-1.00", "Verfügbares Guthaben": "1" },
];

describe("SumUp Transaktionsbericht (schlankes CSV)", () => {
  const { zeilen, uebersprungen } = parseSumUpBerichtZeilen(ROWS);

  it("parst Zeilen, überspringt kaputte", () => {
    expect(zeilen).toHaveLength(2);
    expect(uebersprungen).toBe(1);
  });

  it("behält die Transaktions-ID (formatübergreifender Duplikat-Schutz)", () => {
    expect(zeilen[0].txId).toBe("C9XQG5YB27");
    expect(zeilen[0].betrag).toBe(-420.84);
    expect(zeilen[1].betrag).toBe(470);
  });

  it("Name ohne angehängte IBAN/Länderkürzel, Saldo mit", () => {
    expect(zeilen[1].name).toBe("Muster GmbH");
    expect(zeilen[0].saldo).toBe(1010.38);
  });
});
