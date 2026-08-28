import { describe, expect, it } from "vitest";
import { zerlegeAuszugZeilen } from "./sumupKontoauszug";

// Synthetische Zeilen im Layout des SumUp-Geschäftskonto-Auszugs
// (Struktur 1:1, aber erfundene Daten — keine echten Kontodaten im Repo)
const ZEILEN = [
  "SumUp Account Kontoauszug",
  "Kundennummer: AB1C2DEF",
  "IBAN: IE10SUMU99036599999999",
  "Anfangsguthaben: 100.00 Endguthaben: 1810.92",
  "Datum der Transaktions-ID Art der Transaktion Referenz",
  "28.08.26, CDLWBQR2BN POS-Zahlung Nah und Gut Mund Genehmigt 168.03 0.00 0.00 560.92",
  "12:18 Potsdam DE",
  "27.08.26, CDEWBN3NEN Ausgehende Max Mustermann Rechnung Genehmigt 200.00 0.00 0.00 728.95",
  "14:24 Banküberweisung DE28100500001068529999 RgNr.",
  "4681 0815",
  "26.08.26, C964K3LZYM Eingehende MUSTER GMBH RNr. Genehmigt 0.00 3798.48 0.00 4618.36",
  "07:09 Banküberweisung DE43100208900601809999 2026020",
  "26.08.26, C9LWB5YRJ5 Lastschrift Telekom Beispiel Genehmigt 43.79 0.00 0.00 3619.29",
  "17:20 DE97500400000589019999",
  "25.08.26, COY4G6KX76 POS-Zahlung Falsche Buchung Fehlgeschlagen 95.00 0.00 0.00 819.88",
  "SumUp Limited",
  "Block 8, Harcourt Centre, Charlotte Way, ist ein E-Geld-Institut,",
];

describe("SumUp-Kontoauszug (PDF-Textebene)", () => {
  const { zeilen, uebersprungen, meta } = zerlegeAuszugZeilen(ZEILEN);

  it("parst alle genehmigten Buchungen, überspringt fehlgeschlagene", () => {
    expect(zeilen).toHaveLength(4);
    expect(uebersprungen).toBe(1);
  });

  it("Vorzeichen: Ausgabe negativ, Eingang positiv", () => {
    expect(zeilen[0].betrag).toBe(-168.03);
    expect(zeilen[1].betrag).toBe(-200);
    expect(zeilen[2].betrag).toBe(3798.48);
    expect(zeilen[3].betrag).toBe(-43.79);
  });

  it("Datum ISO, stabile IDs, Saldo", () => {
    expect(zeilen[0].datum).toBe("2026-08-28");
    expect(zeilen[0].txId).toBe("CDLWBQR2BN");
    expect(zeilen[0].saldo).toBe(560.92);
    expect(zeilen[2].name).toBe("MUSTER GMBH RNr.");
  });

  it("Fortsetzungszeilen landen im Zweck (IBAN bleibt erhalten), umgebrochene Art wird zusammengeführt", () => {
    expect(zeilen[1].name).toBe("Max Mustermann Rechnung");
    expect(zeilen[1].zweck).toContain("Ausgehende Banküberweisung");
    expect(zeilen[1].zweck).toContain("DE28100500001068529999");
    expect(zeilen[2].zweck).toContain("Eingehende Banküberweisung");
  });

  it("Prüfsumme: Anfang + Buchungen = Ende", () => {
    // 100 − 168.03 − 200 + 3798.48 − 43.79 = 3486.66 ≠ 1810.92 (bewusst falsch)
    expect(meta.anfangsSaldo).toBe(100);
    expect(meta.endSaldo).toBe(1810.92);
    expect(meta.pruefsummeOk).toBe(false);
    const ok = zerlegeAuszugZeilen([
      "Anfangsguthaben: 0.00 Endguthaben: 1798.48",
      "26.08.26, C964K3LZYM Eingehende Banküberweisung MUSTER GMBH Genehmigt 0.00 3798.48 0.00 3798.48",
      "27.08.26, CDEWBN3NEN Ausgehende Banküberweisung Max Mustermann Genehmigt 2000.00 0.00 0.00 1798.48",
    ]);
    expect(ok.meta.pruefsummeOk).toBe(true);
  });
});
