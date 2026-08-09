// ── Kontoauszug-Import (Bank-CSV + SumUp-Transaktionen) ────────────────────
// Generisches Spalten-Mapping mit Auto-Erkennung; SumUp-Exporte werden an
// ihren Kopfzeilen erkannt und vorkonfiguriert.
import { z } from "zod";
import Papa from "papaparse";
import { authedQuery, createRouter } from "./middleware";
import { getDb } from "./queries/connection";
import { invoices } from "@db/schema";
import { eq } from "drizzle-orm";

function parseCsv(csvText: string): Record<string, string>[] {
  const text = csvText.replace(/^﻿/, "");
  const res = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
    transform: (v) => (typeof v === "string" ? v.trim() : v),
  });
  return res.data.filter((row) =>
    Object.values(row).some((v) => v && v.trim() !== ""),
  );
}

export const mappingInput = z.object({
  datum: z.string(),
  betrag: z.string(),
  name: z.string().nullish(),
  zweck: z.string().nullish(),
  gebuehr: z.string().nullish(),
});

type Mapping = z.infer<typeof mappingInput>;

// Spalten-Kandidaten fuer die Auto-Erkennung (kleingeschrieben)
const KANDIDATEN = {
  datum: ["buchungsdatum", "datum", "valuta", "wertstellung", "buchungstag", "date"],
  betrag: ["betrag", "umsatz", "betrag inkl. mwst.", "betrag inkl mwst", "auszahlung", "amount", "wert"],
  name: ["auftraggeber", "empfänger", "name", "beguenstigter", "gegenkonto", "kunde", "zahler"],
  zweck: ["verwendungszweck", "buchungstext", "beschreibung", "referenz", "zweck", "text", "vorgang"],
  gebuehr: ["gebühr", "gebuehr", "fee"],
};

function errate(spalten: string[]): Mapping & { vorlage: string } {
  const lower = spalten.map((s) => s.toLowerCase());
  const finde = (liste: string[]) => {
    for (const k of liste) {
      const i = lower.findIndex((s) => s === k);
      if (i >= 0) return spalten[i];
    }
    for (const k of liste) {
      const i = lower.findIndex((s) => s.includes(k));
      if (i >= 0) return spalten[i];
    }
    return undefined;
  };

  // SumUp-Transaktionen am Format erkennen
  const istSumUp =
    lower.includes("transaktions-id") && lower.some((s) => s.includes("betrag inkl"));

  const mapping = {
    datum: istSumUp ? "Datum" : finde(KANDIDATEN.datum) ?? spalten[0],
    betrag: istSumUp ? spalten[lower.findIndex((s) => s.includes("betrag inkl"))] : finde(KANDIDATEN.betrag) ?? "",
    name: istSumUp ? "E-Mail" : finde(KANDIDATEN.name),
    zweck: istSumUp ? "Beschreibung" : finde(KANDIDATEN.zweck),
    gebuehr: istSumUp ? "Gebühr" : finde(KANDIDATEN.gebuehr),
  };
  return { ...mapping, vorlage: istSumUp ? "SumUp-Transaktionen" : "Bank-CSV (generisch)" };
}

function betragLesen(roh: string): number | null {
  // deutsches Format "1.234,56" oder englisch "1234.56", ggf. mit € / Währung
  let s = roh.replace(/[€$a-zA-Z\s]/g, "");
  if (!s) return null;
  if (s.includes(",") && s.includes(".")) {
    s = s.lastIndexOf(",") > s.lastIndexOf(".")
      ? s.replace(/\./g, "").replace(",", ".")
      : s.replace(/,/g, "");
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function datumLesen(roh: string): string | null {
  const s = roh.trim();
  let m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (
    m &&
    Number(m[2]) >= 1 && Number(m[2]) <= 12 &&
    Number(m[1]) >= 1 && Number(m[1]) <= 31
  )
    return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}

function parseZeilen(rows: Record<string, string>[], m: Mapping) {
  return rows
    .map((row) => {
      const betrag = betragLesen(row[m.betrag] ?? "");
      const datum = datumLesen(row[m.datum] ?? "");
      if (betrag === null || datum === null) return null;
      return {
        datum,
        betrag,
        name: (m.name ? row[m.name] : "") || "",
        zweck: (m.zweck ? row[m.zweck] : "") || "",
        gebuehr: m.gebuehr ? betragLesen(row[m.gebuehr] ?? "") : null,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null && r.betrag > 0);
}

export const bankImportRouter = createRouter({
  // Schritt 1: Spalten erkennen + Mapping vorschlagen
  spaltenErkennen: authedQuery
    .input(z.object({ csvText: z.string().min(1) }))
    .mutation(({ input }) => {
      const rows = parseCsv(input.csvText);
      if (rows.length === 0) throw new Error("Keine Datenzeilen gefunden — ist das eine CSV-Datei?");
      const spalten = Object.keys(rows[0]);
      const { vorlage, ...mapping } = errate(spalten);
      return { spalten, mapping, vorlage, zeilenGesamt: rows.length };
    }),

  // Schritt 2: Zeilen parsen + offene Rechnungen zuordnen
  vorschlagen: authedQuery
    .input(z.object({ csvText: z.string().min(1), mapping: mappingInput }))
    .mutation(async ({ input }) => {
      const rows = parseCsv(input.csvText);
      const buchungen = parseZeilen(rows, input.mapping);

      const offene = await getDb().select().from(invoices).where(eq(invoices.status, "finalisiert"));
      const offenListe = offene
        .map((r) => ({
          id: r.id,
          nummer: r.nummer!,
          kundeName: r.kundeName,
          offen: Number(r.brutto) - Number(r.bezahltBetrag),
        }))
        .filter((r) => r.offen > 0.004);

      const vorschlaege = buchungen.map((b) => {
        // 1) Rechnungsnummer im Verwendungszweck?
        const imText = offenListe.find(
          (r) => b.zweck.includes(r.nummer) || b.name.includes(r.nummer),
        );
        if (imText) {
          const teil = b.betrag < imText.offen - 0.01;
          return {
            ...b,
            invoiceId: imText.id,
            nummer: imText.nummer,
            kundeName: imText.kundeName,
            offenBetrag: imText.offen,
            status: Math.abs(b.betrag - imText.offen) <= 0.01 ? ("sicher" as const) : ("wahrscheinlich" as const),
            teil,
          };
        }
        // 2) Betrag passt exakt auf eine offene Summe?
        const imBetrag = offenListe.filter((r) => Math.abs(b.betrag - r.offen) <= 0.01);
        if (imBetrag.length === 1) {
          return {
            ...b,
            invoiceId: imBetrag[0].id,
            nummer: imBetrag[0].nummer,
            kundeName: imBetrag[0].kundeName,
            offenBetrag: imBetrag[0].offen,
            status: "wahrscheinlich" as const,
            teil: false,
          };
        }
        return { ...b, status: "kein" as const };
      });

      const gebuehrSumme = vorschlaege.reduce((a, v) => a + (v.gebuehr ?? 0), 0);
      return {
        vorschlaege,
        summe: vorschlaege.reduce((a, v) => a + v.betrag, 0),
        gebuehrSumme: gebuehrSumme > 0 ? gebuehrSumme : null,
        zugeordnet: vorschlaege.filter((v) => v.status !== "kein").length,
        gesamt: vorschlaege.length,
      };
    }),

  // Schritt 3: bestaetigte Zahlungen verbuchen (unterstuetzt Teilzahlungen)
  buchen: authedQuery
    .input(
      z.object({
        zuordnungen: z
          .array(
            z.object({
              invoiceId: z.number(),
              betrag: z.number().positive(),
              datum: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            }),
          )
          .min(1),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      let verbucht = 0;
      for (const z_ of input.zuordnungen) {
        const r = await db.query.invoices.findFirst({ where: eq(invoices.id, z_.invoiceId) });
        if (!r || r.status !== "finalisiert") continue;
        const neu = Math.min(Number(r.brutto), Number(r.bezahltBetrag) + z_.betrag);
        await db
          .update(invoices)
          .set({
            bezahltBetrag: neu.toFixed(2),
            bezahltAm: z_.datum,
          })
          .where(eq(invoices.id, z_.invoiceId));
        verbucht++;
      }
      return { verbucht };
    }),
});
