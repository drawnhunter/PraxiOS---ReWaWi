import { describe, expect, it } from "vitest";
import { extrahiereBelegFelder } from "./belegExtraktion";

const MUSTER = `
Zuther + Hautmann GmbH
Musterstraße 12, 14480 Potsdam

Rechnung
Rechnungs-Nr.: 2026-1147
Rechnungsdatum: 04.09.2026

Position 1  Beratung   1.234,56 EUR

Gesamtbetrag inkl. MwSt.: 1.469,12 EUR
MwSt. 19 %: 234,56 EUR

Bitte überweisen Sie auf DE89 3704 0044 0532 0130 00
`;

describe("extrahiereBelegFelder", () => {
  it("liest Lieferant, Nummer, Datum, Brutto, MwSt, IBAN", () => {
    const e = extrahiereBelegFelder(MUSTER);
    expect(e.lieferant?.wert).toBe("Zuther + Hautmann GmbH");
    expect(e.nummer?.wert).toBe("2026-1147");
    expect(e.datum?.wert).toBe("2026-09-04");
    expect(e.brutto?.wert).toBe("1.469,12");
    expect(e.mwst?.wert).toBe("234,56");
    expect(e.iban?.wert).toBe("DE89370400440532013000");
  });

  it("überlebt leeren Text", () => {
    const e = extrahiereBelegFelder("");
    expect(Object.keys(e)).toHaveLength(0);
  });

  it("normalisiert zweistellige Jahre und ISO-Daten", () => {
    const e = extrahiereBelegFelder("Rechnungsdatum: 04.09.26\nRechnungs-Nr.: RE-77\nGesamt: 10,00 €");
    expect(e.datum?.wert).toBe("2026-09-04");
    expect(e.nummer?.wert).toBe("RE-77");
  });
});
