// ── Alt-Rechnungen importieren (z. B. SumUp-Rechnungsexport) ───────────────
// Generisches Spalten-Mapping; Zeilen mit gleicher Rechnungsnummer werden zu
// einem Beleg gruppiert (Positionen). Import erfolgt mit ORIGINAL-Nummern als
// finalisierte Belege (Altbestand) — der eigene Nummernkreis bleibt unberuehrt.
import { z } from "zod";
import Papa from "papaparse";
import { eq } from "drizzle-orm";
import { authedQuery, createRouter } from "./middleware";
import { getDb } from "./queries/connection";
import { invoices } from "@db/schema";
import { computeTotals, centToDecimal } from "@contracts/invoicing";
import { analysiereSumUpPdfDatei } from "./lib/sumupPdf";
import { analysiereXrechnung } from "./xrechnungEinlesen";
import { bucheAltbestand, type AltbestandGruppe } from "./lib/altbestand";

// ── Datei → Altbestand-Gruppe (SumUp-PDF oder XRechnung, ausgehende Belege) ──
type DateiErgebnis = (AltbestandGruppe & { quelle: "SumUp-PDF" | "XRechnung"; warnung: string | null }) | { fehler: string };

async function dateiZuGruppe(name: string, puffer: Buffer): Promise<DateiErgebnis> {
  const lower = name.toLowerCase();

  if (lower.endsWith(".xml")) {
    const xml = puffer.toString("utf8");
    const { daten, fehler } = analysiereXrechnung(xml);
    if (fehler.length > 0 || !daten) return { fehler: `Keine gültige XRechnung: ${fehler.join("; ")}` };
    if (!daten.datum) return { fehler: "Rechnungsdatum fehlt in der XRechnung." };
    const kaeufer = daten.kaeufer;
    if (!kaeufer?.name) return { fehler: "Käufer (BuyerTradeParty) fehlt in der XRechnung." };
    return {
      quelle: "XRechnung",
      warnung: null,
      nummer: daten.nummer,
      datum: daten.datum,
      faellig: daten.faellig,
      kunde: kaeufer.name,
      kundeStrasse: kaeufer.strasse,
      kundePlz: kaeufer.plz,
      kundeOrt: kaeufer.ort,
      kundeEmail: null,
      bezahlt: true, // Altbestand ohne Zahlungsstatus gilt als bezahlt
      items: daten.positionen.map((p) => ({
        bezeichnung: p.bezeichnung,
        menge: String(p.menge),
        einheit: p.einheit,
        einzelpreis: p.einzelpreis.toFixed(2),
        ustSatz: p.ustSatz,
      })),
      bruttoCent: Math.round(daten.brutto * 100),
      nettoCent: Math.round(daten.netto * 100),
      ustCent: Math.round(daten.ust * 100),
    };
  }

  if (lower.endsWith(".pdf")) {
    let sumup;
    try {
      sumup = await analysiereSumUpPdfDatei(puffer);
    } catch (e) {
      return { fehler: `PDF ist keine importierbare SumUp-Rechnung: ${e instanceof Error ? e.message : String(e)}` };
    }
    if (sumup.storniert) {
      return { fehler: "Stornierte Rechnung — nicht importierbar (Storno bitte manuell als Gutschrift erfassen)." };
    }
    const vollBezahlt = sumup.bezahlt >= sumup.brutto - 0.01;
    const teilBezahlt = !vollBezahlt && sumup.bezahlt > 0.005;
    return {
      quelle: "SumUp-PDF",
      warnung: sumup.warnung,
      nummer: sumup.nummer,
      datum: sumup.datum,
      faellig: sumup.faellig,
      kunde: sumup.kunde,
      kundeStrasse: sumup.kundeStrasse,
      kundePlz: sumup.kundePlz,
      kundeOrt: sumup.kundeOrt,
      kundeEmail: null,
      bezahlt: vollBezahlt,
      bezahltBetragCent: teilBezahlt ? Math.round(sumup.bezahlt * 100) : undefined,
      items: sumup.positionen.map((p) => ({
        bezeichnung: p.bezeichnung,
        menge: String(p.menge),
        einheit: p.einheit,
        einzelpreis: p.einzelpreis.toFixed(2),
        ustSatz: p.ustSatz,
      })),
      bruttoCent: Math.round(sumup.brutto * 100),
      nettoCent: Math.round(sumup.netto * 100),
      ustCent: Math.round(sumup.ust * 100),
    };
  }

  return { fehler: "Dateityp wird nicht unterstützt (erwartet: SumUp-PDF oder XRechnung-XML)." };
}

function parseCsv(csvText: string): Record<string, string>[] {
  const res = Papa.parse<Record<string, string>>(csvText.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
    transform: (v) => (typeof v === "string" ? v.trim() : v),
  });
  return res.data.filter((row) =>
    Object.values(row).some((v) => v && v.trim() !== ""),
  );
}

const mappingInput = z.object({
  nummer: z.string(),
  datum: z.string(),
  kunde: z.string(),
  faellig: z.string().nullish(),
  kundeStrasse: z.string().nullish(),
  kundePlz: z.string().nullish(),
  kundeOrt: z.string().nullish(),
  kundeEmail: z.string().nullish(),
  status: z.string().nullish(),
  beschreibung: z.string().nullish(),
  menge: z.string().nullish(),
  einzelpreis: z.string().nullish(),
  einheit: z.string().nullish(),
  ustSatz: z.string().nullish(),
  brutto: z.string().nullish(),
});
type Mapping = z.infer<typeof mappingInput>;

const KANDIDATEN: Record<string, string[]> = {
  nummer: ["rechnungsnummer", "invoice number", "invoice no", "invoice_number", "rechnungs-nr.", "rechnungs-nr", "belegnummer", "nummer", "invoice id"],
  datum: ["rechnungsdatum", "invoice date", "ausstellungsdatum", "issue date", "datum", "date", "created"],
  kunde: ["kundenname", "kunde", "customer name", "customer", "empfänger", "name"],
  faellig: ["fälligkeitsdatum", "fällig", "due date", "faellig"],
  kundeStrasse: ["straße", "strasse", "street", "adresse", "address"],
  kundePlz: ["plz", "postleitzahl", "zip", "postal"],
  kundeOrt: ["ort", "stadt", "city"],
  kundeEmail: ["e-mail", "email", "mail"],
  status: ["status", "zahlungsstatus", "paid"],
  beschreibung: ["beschreibung", "bezeichnung", "artikel", "produkt", "leistung", "item name", "item", "description"],
  menge: ["menge", "anzahl", "quantity", "qty"],
  einzelpreis: ["einzelpreis", "preis (netto)", "preis netto", "unit price", "preis", "netto", "price"],
  einheit: ["einheit", "unit"],
  ustSatz: ["ust-satz", "ust", "mwst", "steuersatz", "tax rate (%)", "tax rate", "tax"],
  brutto: ["gesamtbetrag", "brutto", "gesamt", "total (gross)", "total", "betrag", "summe", "amount"],
};

function errateMapping(spalten: string[]): Mapping {
  const lower = spalten.map((s) => s.toLowerCase());
  const finde = (key: string) => {
    for (const k of KANDIDATEN[key]) {
      const i = lower.findIndex((s) => s === k);
      if (i >= 0) return spalten[i];
    }
    for (const k of KANDIDATEN[key]) {
      const i = lower.findIndex((s) => s.includes(k));
      if (i >= 0) return spalten[i];
    }
    return undefined;
  };
  return {
    nummer: finde("nummer") ?? spalten[0],
    datum: finde("datum") ?? "",
    kunde: finde("kunde") ?? "",
    faellig: finde("faellig"),
    kundeStrasse: finde("kundeStrasse"),
    kundePlz: finde("kundePlz"),
    kundeOrt: finde("kundeOrt"),
    kundeEmail: finde("kundeEmail"),
    status: finde("status"),
    beschreibung: finde("beschreibung"),
    menge: finde("menge"),
    einzelpreis: finde("einzelpreis"),
    einheit: finde("einheit"),
    ustSatz: finde("ustSatz"),
    brutto: finde("brutto"),
  };
}

function betragLesen(roh: string): number | null {
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
  let m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (
    m &&
    Number(m[2]) >= 1 && Number(m[2]) <= 12 &&
    Number(m[1]) >= 1 && Number(m[1]) <= 31
  )
    return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}

const BEZAHLT_WERTE = ["paid", "bezahlt", "beglichen", "1", "ja", "yes", "true", "erstattet"];

interface Gruppe {
  nummer: string;
  datum: string | null;
  faellig: string | null;
  kunde: string;
  kundeStrasse: string | null;
  kundePlz: string | null;
  kundeOrt: string | null;
  kundeEmail: string | null;
  bezahlt: boolean;
  items: { bezeichnung: string; menge: string; einheit: string; einzelpreis: string; ustSatz: number }[];
  bruttoCent: number;
  nettoCent: number;
  ustCent: number;
  warnung: string | null;
}

function gruppiere(rows: Record<string, string>[], m: Mapping): Gruppe[] {
  const nachNummer = new Map<string, Record<string, string>[]>();
  for (const row of rows) {
    const nr = (row[m.nummer] ?? "").trim();
    if (!nr) continue;
    if (!nachNummer.has(nr)) nachNummer.set(nr, []);
    nachNummer.get(nr)!.push(row);
  }

  const mitPositionen = !!(m.beschreibung && m.einzelpreis);

  return [...nachNummer.entries()].map(([nummer, zeilen]) => {
    const kopf = zeilen[0];
    const datum = datumLesen(kopf[m.datum] ?? "");
    const kunde = (m.kunde ? kopf[m.kunde] : "")?.trim() ?? "";
    const bezahlt = m.status
      ? BEZAHLT_WERTE.includes((kopf[m.status] ?? "").trim().toLowerCase())
      : true; // ohne Statusspalte: Altbestand gilt als bezahlt

    const items: Gruppe["items"] = [];
    if (mitPositionen) {
      for (const z of zeilen) {
        const beschreibung = (z[m.beschreibung!] ?? "").trim() || "Position";
        const mengeN = betragLesen(m.menge ? z[m.menge] ?? "" : "") ?? 1;
        const preisN = betragLesen(z[m.einzelpreis!] ?? "") ?? 0;
        const satzN = m.ustSatz ? Math.round(betragLesen(z[m.ustSatz] ?? "") ?? 19) : 19;
        items.push({
          bezeichnung: beschreibung,
          menge: String(mengeN),
          einheit: (m.einheit ? z[m.einheit] : "")?.trim() || "Stück",
          einzelpreis: preisN.toFixed(2),
          ustSatz: [19, 7, 0].includes(satzN) ? satzN : 19,
        });
      }
    } else {
      // Kopfebene: eine Sammelposition aus dem Bruttogesamtbetrag
      const bruttoN = m.brutto ? betragLesen(kopf[m.brutto] ?? "") : null;
      const satzN = m.ustSatz ? Math.round(betragLesen(kopf[m.ustSatz] ?? "") ?? 19) : 19;
      const satz = [19, 7, 0].includes(satzN) ? satzN : 19;
      const nettoN = bruttoN !== null ? bruttoN / (1 + satz / 100) : 0;
      items.push({
        bezeichnung: `Rechnung ${nummer} (Import)`,
        menge: "1",
        einheit: "Stück",
        einzelpreis: nettoN.toFixed(2),
        ustSatz: satz,
      });
    }

    const totals = computeTotals(items);
    const warnung = !datum
      ? "Datum nicht lesbar — Zeile wird übersprungen"
      : !kunde
        ? "Kunde fehlt — Zeile wird übersprungen"
        : totals.bruttoCent === 0
          ? "Betrag 0 — bitte prüfen"
          : null;

    return {
      nummer,
      datum,
      faellig: m.faellig ? datumLesen(kopf[m.faellig] ?? "") : null,
      kunde,
      kundeStrasse: m.kundeStrasse ? kopf[m.kundeStrasse] || null : null,
      kundePlz: m.kundePlz ? kopf[m.kundePlz] || null : null,
      kundeOrt: m.kundeOrt ? kopf[m.kundeOrt] || null : null,
      kundeEmail: m.kundeEmail ? kopf[m.kundeEmail] || null : null,
      bezahlt,
      items,
      bruttoCent: totals.bruttoCent,
      nettoCent: totals.nettoCent,
      ustCent: totals.ustCent,
      warnung,
    };
  });
}

export const invoiceImportRouter = createRouter({
  spaltenErkennen: authedQuery
    .input(z.object({ csvText: z.string().min(1) }))
    .mutation(({ input }) => {
      const rows = parseCsv(input.csvText);
      if (rows.length === 0) throw new Error("Keine Datenzeilen gefunden.");
      const spalten = Object.keys(rows[0]);
      return { spalten, mapping: errateMapping(spalten), zeilenGesamt: rows.length };
    }),

  vorschau: authedQuery
    .input(z.object({ csvText: z.string().min(1), mapping: mappingInput }))
    .mutation(async ({ input }) => {
      const rows = parseCsv(input.csvText);
      const gruppen = gruppiere(rows, input.mapping);
      // Duplikate gegen die Datenbank markieren
      const db = getDb();
      const mitStatus = await Promise.all(
        gruppen.map(async (g) => {
          const dup = await db.query.invoices.findFirst({
            where: eq(invoices.nummer, g.nummer),
          });
          return { ...g, existiert: !!dup };
        }),
      );
      return {
        gruppen: mitStatus,
        gesamt: mitStatus.length,
        importierbar: mitStatus.filter((g) => !g.warnung && !g.existiert).length,
        duplikate: mitStatus.filter((g) => g.existiert).length,
        fehlerhaft: mitStatus.filter((g) => g.warnung).length,
      };
    }),

  importieren: authedQuery
    .input(z.object({ csvText: z.string().min(1), mapping: mappingInput }))
    .mutation(async ({ input }) => {
      const gruppen = gruppiere(parseCsv(input.csvText), input.mapping).filter((g) => !g.warnung);
      const ergebnis = await bucheAltbestand(gruppen);
      return { ...ergebnis, fehler: ergebnis.fehler.slice(0, 20) };
    }),

  /** Vorschau: SumUp-PDFs + XRechnung-XMLs analysieren (Batch). */
  analysierenDateien: authedQuery
    .input(
      z.object({
        dateien: z.array(z.object({ name: z.string().min(1).max(255), base64: z.string().min(4) })).min(1).max(50),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const ergebnisse: {
        name: string;
        ok: boolean;
        fehler?: string;
        existiert?: boolean;
        gruppe?: {
          nummer: string; datum: string | null; kunde: string; positionen: number;
          brutto: string; bezahlt: boolean; quelle: "SumUp-PDF" | "XRechnung";
        };
      }[] = [];

      for (const d of input.dateien) {
        const puffer = Buffer.from(d.base64, "base64");
        try {
          const g = await dateiZuGruppe(d.name, puffer);
          if ("fehler" in g) {
            ergebnisse.push({ name: d.name, ok: false, fehler: g.fehler });
            continue;
          }
          if (g.warnung) {
            ergebnisse.push({ name: d.name, ok: false, fehler: g.warnung });
            continue;
          }
          const dup = await db.query.invoices.findFirst({ where: eq(invoices.nummer, g.nummer) });
          ergebnisse.push({
            name: d.name,
            ok: true,
            existiert: !!dup,
            gruppe: {
              nummer: g.nummer,
              datum: g.datum,
              kunde: g.kunde,
              positionen: g.items.length,
              brutto: centToDecimal(g.bruttoCent),
              bezahlt: g.bezahlt,
              quelle: g.quelle,
            },
          });
        } catch (e) {
          ergebnisse.push({ name: d.name, ok: false, fehler: e instanceof Error ? e.message : String(e) });
        }
      }
      return {
        dateien: ergebnisse,
        importierbar: ergebnisse.filter((e) => e.ok && !e.existiert).length,
        duplikate: ergebnisse.filter((e) => e.ok && e.existiert).length,
        fehlerhaft: ergebnisse.filter((e) => !e.ok).length,
      };
    }),

  /** Import: SumUp-PDFs + XRechnung-XMLs buchen (Batch). */
  importierenDateien: authedQuery
    .input(
      z.object({
        dateien: z.array(z.object({ name: z.string().min(1).max(255), base64: z.string().min(4) })).min(1).max(50),
      }),
    )
    .mutation(async ({ input }) => {
      const gruppen: AltbestandGruppe[] = [];
      const dateiFehler: { name: string; fehler: string }[] = [];
      for (const d of input.dateien) {
        try {
          const g = await dateiZuGruppe(d.name, Buffer.from(d.base64, "base64"));
          if ("fehler" in g) dateiFehler.push({ name: d.name, fehler: g.fehler });
          else if (g.warnung) dateiFehler.push({ name: d.name, fehler: g.warnung });
          else gruppen.push(g);
        } catch (e) {
          dateiFehler.push({ name: d.name, fehler: e instanceof Error ? e.message : String(e) });
        }
      }
      const ergebnis = await bucheAltbestand(gruppen);
      return { ...ergebnis, dateiFehler };
    }),
});
