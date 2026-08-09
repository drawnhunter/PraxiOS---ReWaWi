// ── Banking (v1.3): persistente Bank-Transaktionen je Konto ────────────────
// Import landet dauerhaft in bank_transaktionen (Duplikat-Schutz per Hash),
// Zuordnung zu Ausgangs- UND Eingangsrechnungen — automatisch vorgeschlagen,
// manuell in beide Richtungen (von der Transaktion und von der Rechnung).
import { z } from "zod";
import Papa from "papaparse";
import { createHash } from "node:crypto";
import { authedQuery, createRouter } from "./middleware";
import { getDb } from "./queries/connection";
import {
  bankAccounts,
  bankImporte,
  bankTransaktionen,
  invoices,
  incomingInvoices,
} from "@db/schema";
import { and, asc, desc, eq, gte, lte, isNull, sql } from "drizzle-orm";
import { erstelleKontoauszugPdf } from "./pdfKontoauszug";

// ── CSV-Parsing (aus dem bisherigen bankImportRouter, erweitert) ───────────
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

const mappingInput = z.object({
  datum: z.string(),
  betrag: z.string(),
  name: z.string().nullish(),
  zweck: z.string().nullish(),
  gebuehr: z.string().nullish(),
  saldo: z.string().nullish(),
});
type Mapping = z.infer<typeof mappingInput>;

const KANDIDATEN = {
  datum: ["buchungsdatum", "datum", "valuta", "wertstellung", "buchungstag", "date"],
  betrag: ["betrag", "umsatz", "betrag inkl. mwst.", "betrag inkl mwst", "auszahlung", "amount", "wert"],
  name: ["auftraggeber", "empfänger", "name", "beguenstigter", "gegenkonto", "kunde", "zahler"],
  zweck: ["verwendungszweck", "buchungstext", "beschreibung", "referenz", "zweck", "text", "vorgang"],
  gebuehr: ["gebühr", "gebuehr", "fee"],
  saldo: ["saldo", "kontostand", "endsaldo", "kontostand in eur", "balance"],
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
  const istSumUp =
    lower.includes("transaktions-id") && lower.some((s) => s.includes("betrag inkl"));
  // SumUp-Konto VOLLEXPORT (15 Spalten, "Rechnungsbetrag ausgehend/eingehend"):
  // wird in importieren() ueber einen dedizierten Parser verarbeitet — das
  // generische Mapping greift hier nicht (zwei Betragsspalten + deutsches
  // Datumsformat mit Komma im Feld).
  const istSumUpVoll =
    lower.includes("art der transaktion") &&
    lower.includes("rechnungsbetrag ausgehend") &&
    lower.includes("rechnungsbetrag eingehend");
  if (istSumUpVoll) {
    return {
      datum: "Datum der Transaktion",
      betrag: "__sumup_voll__",
      name: "Referenz",
      zweck: "Zahlungsreferenz",
      gebuehr: "Gebühr",
      saldo: "Verfügbares Guthaben",
      vorlage: "SumUp-Konto (Vollexport)",
    };
  }
  const mapping = {
    datum: istSumUp ? "Datum" : finde(KANDIDATEN.datum) ?? spalten[0],
    betrag: istSumUp ? spalten[lower.findIndex((s) => s.includes("betrag inkl"))] : finde(KANDIDATEN.betrag) ?? "",
    name: istSumUp ? "E-Mail" : finde(KANDIDATEN.name),
    zweck: istSumUp ? "Beschreibung" : finde(KANDIDATEN.zweck),
    gebuehr: istSumUp ? "Gebühr" : finde(KANDIDATEN.gebuehr),
    saldo: finde(KANDIDATEN.saldo),
  };
  return { ...mapping, vorlage: istSumUp ? "SumUp-Transaktionen" : "Bank-CSV (generisch)" };
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
  let m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12 && Number(m[1]) >= 1 && Number(m[1]) <= 31)
    return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}

interface Zeile {
  datum: string;
  betrag: number;
  name: string;
  zweck: string;
  gebuehr: number | null;
  saldo: number | null;
  /** Stabile ID des Anbieters (z. B. SumUp-Transaktions-ID) — Duplikat-Schutz. */
  txId?: string;
}

function parseZeilen(rows: Record<string, string>[], m: Mapping): Zeile[] {
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
        saldo: m.saldo ? betragLesen(row[m.saldo] ?? "") : null,
      };
    })
    .filter((r): r is Zeile => r !== null && r.betrag !== 0);
}

// ── SumUp-Konto VOLLEXPORT ─────────────────────────────────────────────────
// Datum: "03.08.26, 17:54" (deutsch, 2-stelliges Jahr, Komma im gequoteten Feld)
function sumUpDatumLesen(roh: string): string | null {
  const m = roh.trim().match(/^(\d{2})\.(\d{2})\.(\d{2}),\s*(\d{2}):(\d{2})/);
  if (!m) return null;
  return `20${m[3]}-${m[2]}-${m[1]}`;
}

// Vorgemerkte/ungueltige Buchungen nicht importieren (werden beim naechsten
// Export nach Statuswechsel automatisch nachgeholt; Duplikat-Schutz per ID).
const SUMUP_STATUS_SKIP = /^(in bearbeitung|abgelehnt|fehlgeschlagen|storniert)$/i;

// Referenz enthaelt oft eine angehaengte IBAN ("IONOS SE DE83...") sowie
// Länderkuerzel nach Mehrfach-Leerzeichen ("AMAZON   LU") — fuer den Namen
// abschneiden; der Volltext bleibt im Zweck erhalten.
function sumUpName(referenz: string): string {
  let t = referenz.replace(/\s+[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/, "");
  t = t.replace(/\s{2,}[A-Z]{2}\s*$/, "");
  return t.replace(/\s{2,}/g, " ").trim();
}

function parseSumUpVollZeilen(rows: Record<string, string>[]): { zeilen: Zeile[]; uebersprungen: number } {
  const zeilen: Zeile[] = [];
  let uebersprungen = 0;
  for (const row of rows) {
    const status = (row["Status"] ?? "").trim();
    if (SUMUP_STATUS_SKIP.test(status)) { uebersprungen++; continue; }
    const datum = sumUpDatumLesen(row["Datum der Transaktion"] ?? "");
    if (!datum) { uebersprungen++; continue; }
    const aus = betragLesen(row["Rechnungsbetrag ausgehend"] ?? "") ?? 0;
    const ein = betragLesen(row["Rechnungsbetrag eingehend"] ?? "") ?? 0;
    const betrag = ein - aus;
    if (Math.abs(betrag) < 0.005) { uebersprungen++; continue; }
    const referenz = (row["Referenz"] ?? "").trim();
    const zahlungsreferenz = (row["Zahlungsreferenz"] ?? "").trim();
    const art = (row["Art der Transaktion"] ?? "").trim();
    // Fremdwaehrung: buchhalterisch zaehlt der EUR-Rechnungsbetrag; die
    // Kartenabrechnung (z. B. 50.00 USD @ 0.87) kommt als Info in den Zweck.
    const zw = (row["Zahlungswährung"] ?? "").trim();
    let fxInfo = "";
    if (zw && zw !== "EUR") {
      const zAus = betragLesen(row["Zahlungsbetrag ausgehend"] ?? "");
      const zEin = betragLesen(row["Zahlungsbetrag eingehend"] ?? "");
      const zBetrag = (zEin ?? 0) - (zAus ?? 0);
      const kurs = (row["Wechselkurs"] ?? "").trim();
      fxInfo = `Karte: ${Math.abs(zBetrag).toFixed(2)} ${zw}${kurs ? ` @ ${kurs}` : ""}`;
    }
    const zweck = [art, zahlungsreferenz, fxInfo].filter(Boolean).join(" · ");
    const geb = betragLesen(row["Gebühr"] ?? "");
    zeilen.push({
      datum,
      betrag,
      name: sumUpName(referenz) || referenz || art,
      zweck,
      gebuehr: geb && Math.abs(geb) > 0.004 ? geb : null,
      saldo: betragLesen(row["Verfügbares Guthaben"] ?? ""),
      txId: (row["Transaktions-ID"] ?? "").trim() || undefined,
    });
  }
  return { zeilen, uebersprungen };
}

function txHash(kontoId: number, z: Zeile): string {
  // Stabile Anbieter-ID bevorzugen (SumUp): identische Betraege/Texte
  // (z. B. zwei gleiche Rueckerstattungen) bleiben so unterscheidbar.
  if (z.txId) {
    return createHash("sha256").update(`sumup:${kontoId}:${z.txId}`).digest("hex").slice(0, 32);
  }
  return createHash("sha256")
    .update(`${kontoId}|${z.datum}|${z.betrag.toFixed(2)}|${z.name}|${z.zweck}`)
    .digest("hex")
    .slice(0, 32);
}

// ── Auto-Matching ──────────────────────────────────────────────────────────
type Vorschlag =
  | { typ: "ausgang"; zielId: number; nummer: string; bezeichner: string; offenBetrag: number; sicherheit: "sicher" | "wahrscheinlich"; teil: boolean }
  | { typ: "eingang"; zielId: number; nummer: string; bezeichner: string; offenBetrag: number; sicherheit: "sicher" | "wahrscheinlich" };

async function autoMatch(z: Zeile): Promise<Vorschlag | null> {
  const db = getDb();
  if (z.betrag > 0) {
    const offene = await db.select().from(invoices).where(eq(invoices.status, "finalisiert"));
    const liste = offene
      .map((r) => ({ id: r.id, nummer: r.nummer!, kunde: r.kundeName, offen: Number(r.brutto) - Number(r.bezahltBetrag) }))
      .filter((r) => r.offen > 0.004);
    // 1) Rechnungsnummer im Text
    const imText = liste.find((r) => z.zweck.includes(r.nummer) || z.name.includes(r.nummer));
    if (imText) {
      const voll = Math.abs(z.betrag - imText.offen) <= 0.01;
      return {
        typ: "ausgang", zielId: imText.id, nummer: imText.nummer, bezeichner: imText.kunde,
        offenBetrag: imText.offen, sicherheit: voll ? "sicher" : "wahrscheinlich", teil: z.betrag < imText.offen - 0.01,
      };
    }
    // 2) Betrag exakt + eindeutig
    const imBetrag = liste.filter((r) => Math.abs(z.betrag - r.offen) <= 0.01);
    if (imBetrag.length === 1) {
      return {
        typ: "ausgang", zielId: imBetrag[0].id, nummer: imBetrag[0].nummer, bezeichner: imBetrag[0].kunde,
        offenBetrag: imBetrag[0].offen, sicherheit: "wahrscheinlich", teil: false,
      };
    }
    return null;
  }
  // Ausgang → offene Eingangsrechnungen (Betrag oder Lieferantenname)
  const betragAbs = Math.abs(z.betrag);
  const offene = await db.select().from(incomingInvoices).where(isNull(incomingInvoices.bezahltAm));
  const liste = offene.map((r) => ({
    id: r.id, nummer: r.nummer, lieferant: r.lieferantName, offen: Number(r.brutto),
  }));
  const imText = liste.find(
    (r) => (r.nummer && (z.zweck.includes(r.nummer) || z.name.includes(r.nummer))) ||
      (r.lieferant && z.name.toLowerCase().includes(r.lieferant.toLowerCase().slice(0, 12))),
  );
  if (imText) {
    const voll = Math.abs(betragAbs - imText.offen) <= 0.01;
    return {
      typ: "eingang", zielId: imText.id, nummer: imText.nummer, bezeichner: imText.lieferant,
      offenBetrag: imText.offen, sicherheit: voll ? "sicher" : "wahrscheinlich",
    };
  }
  const imBetrag = liste.filter((r) => Math.abs(betragAbs - r.offen) <= 0.01);
  if (imBetrag.length === 1) {
    return {
      typ: "eingang", zielId: imBetrag[0].id, nummer: imBetrag[0].nummer, bezeichner: imBetrag[0].lieferant,
      offenBetrag: imBetrag[0].offen, sicherheit: "wahrscheinlich",
    };
  }
  return null;
}

// ── Kern: Zahlung auf Beleg buchen / zurückbuchen ──────────────────────────
async function bucheAufRechnung(invoiceId: number, betrag: number, datum: string): Promise<number> {
  const db = getDb();
  const r = await db.query.invoices.findFirst({ where: eq(invoices.id, invoiceId) });
  if (!r || r.status !== "finalisiert") throw new Error("Rechnung nicht gefunden oder nicht finalisiert.");
  const offen = Number(r.brutto) - Number(r.bezahltBetrag);
  if (offen <= 0.004) throw new Error(`Rechnung ${r.nummer} ist bereits vollständig bezahlt.`);
  const verbucht = Math.min(betrag, offen);
  await db
    .update(invoices)
    .set({ bezahltBetrag: (Number(r.bezahltBetrag) + verbucht).toFixed(2), bezahltAm: datum })
    .where(eq(invoices.id, invoiceId));
  return verbucht;
}

async function bucheAufEingangsrechnung(incomingId: number, datum: string): Promise<void> {
  const db = getDb();
  const r = await db.query.incomingInvoices.findFirst({ where: eq(incomingInvoices.id, incomingId) });
  if (!r) throw new Error("Eingangsrechnung nicht gefunden.");
  if (r.bezahltAm) throw new Error(`Eingangsrechnung ${r.nummer} ist bereits als bezahlt markiert.`);
  await db.update(incomingInvoices).set({ bezahltAm: datum }).where(eq(incomingInvoices.id, incomingId));
}

export const bankTransaktionenRouter = createRouter({
  /** Schritt 1 (Import): Spalten erkennen + Mapping vorschlagen. */
  spaltenErkennen: authedQuery
    .input(z.object({ csvText: z.string().min(1) }))
    .mutation(({ input }) => {
      const rows = parseCsv(input.csvText);
      if (rows.length === 0) throw new Error("Keine Datenzeilen gefunden — ist das eine CSV-Datei?");
      const spalten = Object.keys(rows[0]);
      const { vorlage, ...mapping } = errate(spalten);
      return { spalten, mapping, vorlage, zeilenGesamt: rows.length };
    }),

  /** Schritt 2: Importieren — persistiert alle Zeilen, liefert Vorschau mit Auto-Matches. */
  importieren: authedQuery
    .input(z.object({ bankAccountId: z.number(), dateiname: z.string().min(1).max(255), csvText: z.string().min(1), mapping: mappingInput }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const konto = await db.query.bankAccounts.findFirst({ where: eq(bankAccounts.id, input.bankAccountId) });
      if (!konto) throw new Error("Bankkonto nicht gefunden.");
      const csvRows = parseCsv(input.csvText);
      const istSumUpVoll = input.mapping.betrag === "__sumup_voll__";
      const { zeilen, uebersprungen } = istSumUpVoll
        ? parseSumUpVollZeilen(csvRows)
        : { zeilen: parseZeilen(csvRows, input.mapping), uebersprungen: 0 };
      if (zeilen.length === 0) throw new Error("Keine verwertbaren Zeilen (Datum/Betrag) gefunden.");
      const { vorlage } = errate(Object.keys(csvRows[0] ?? {}));

      let summeEin = 0;
      let summeAus = 0;
      let duplikate = 0;
      const neu: { id: number; z: Zeile }[] = [];

      const [{ id: importId }] = await db
        .insert(bankImporte)
        .values({ bankAccountId: input.bankAccountId, dateiname: input.dateiname, vorlage })
        .$returningId();

      for (const z of zeilen) {
        const hash = txHash(input.bankAccountId, z);
        const vorhanden = await db.query.bankTransaktionen.findFirst({
          where: and(eq(bankTransaktionen.bankAccountId, input.bankAccountId), eq(bankTransaktionen.hash, hash)),
        });
        if (vorhanden) { duplikate++; continue; }
        const [{ id }] = await db
          .insert(bankTransaktionen)
          .values({
            bankAccountId: input.bankAccountId,
            importId,
            datum: z.datum,
            name: z.name,
            zweck: z.zweck || null,
            betrag: z.betrag.toFixed(2),
            gebuehr: z.gebuehr?.toFixed(2) ?? null,
            saldoNach: z.saldo?.toFixed(2) ?? null,
            hash,
          })
          .$returningId();
        neu.push({ id, z });
        if (z.betrag > 0) summeEin += z.betrag; else summeAus += -z.betrag;
      }

      await db
        .update(bankImporte)
        .set({ zeilen: neu.length, duplikate, summeEin: summeEin.toFixed(2), summeAus: summeAus.toFixed(2) })
        .where(eq(bankImporte.id, importId));

      // Auto-Match nur fuer neue, noch offene Transaktionen
      const vorschau = [] as {
        transaktionId: number; datum: string; name: string; zweck: string;
        betrag: number; gebuehr: number | null; vorschlag: Vorschlag | null;
      }[];
      for (const { id, z } of neu) {
        vorschau.push({
          transaktionId: id, datum: z.datum, name: z.name, zweck: z.zweck,
          betrag: z.betrag, gebuehr: z.gebuehr, vorschlag: await autoMatch(z),
        });
      }
      return {
        importId,
        importiert: neu.length,
        duplikate,
        uebersprungen,
        summeEin,
        summeAus,
        zugeordnet: vorschau.filter((v) => v.vorschlag).length,
        vorschau,
      };
    }),

  /** Schritt 3: Ausgewaehlte Auto-Vorschlaege buchen (Batch). */
  zuordnungenBuchen: authedQuery
    .input(
      z.object({
        zuordnungen: z.array(z.object({
          transaktionId: z.number(),
          typ: z.enum(["ausgang", "eingang"]),
          zielId: z.number(),
        })).min(1),
      }),
    )
    .mutation(async ({ input }) => {
      let verbucht = 0;
      const fehler: string[] = [];
      for (const z of input.zuordnungen) {
        try {
          await zuordneIntern(z.transaktionId, z.typ, z.zielId);
          verbucht++;
        } catch (e) {
          fehler.push(`#${z.transaktionId}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      return { verbucht, fehler };
    }),

  /** Konto-Karten: Saldo, offene Posten, letzter Import je aktivem Konto. */
  kontenUebersicht: authedQuery.query(async () => {
    const db = getDb();
    const konten = await db
      .select()
      .from(bankAccounts)
      .orderBy(desc(bankAccounts.istStandard), asc(bankAccounts.bezeichnung));
    const aus = [];
    for (const k of konten) {
      const [agg] = await db
        .select({
          summe: sql<string | null>`COALESCE(SUM(${bankTransaktionen.betrag}), 0)`,
          offen: sql<string | null>`COALESCE(SUM(CASE WHEN ${bankTransaktionen.status} = 'offen' THEN 1 ELSE 0 END), 0)`,
          anzahl: sql<string | null>`COUNT(*)`,
          letztesDatum: sql<string | null>`DATE_FORMAT(MAX(${bankTransaktionen.datum}), '%Y-%m-%d')`,
        })
        .from(bankTransaktionen)
        .where(eq(bankTransaktionen.bankAccountId, k.id));
      // Saldo: letzter bekannter saldo_nach (nach Datum+ID), sonst Summe aller Buchungen
      const letzteSaldo = await db
        .select({ saldo: bankTransaktionen.saldoNach })
        .from(bankTransaktionen)
        .where(and(eq(bankTransaktionen.bankAccountId, k.id), sql`${bankTransaktionen.saldoNach} IS NOT NULL`))
        .orderBy(desc(bankTransaktionen.datum), desc(bankTransaktionen.id))
        .limit(1);
      const letzterImport = await db
        .select({ am: bankImporte.createdAt, dateiname: bankImporte.dateiname })
        .from(bankImporte)
        .where(eq(bankImporte.bankAccountId, k.id))
        .orderBy(desc(bankImporte.createdAt))
        .limit(1);
      aus.push({
        konto: k,
        saldo: letzteSaldo[0]?.saldo ?? (Number(agg?.anzahl ?? 0) > 0 ? String(agg?.summe ?? "0") : null),
        saldoIstBerechnet: !letzteSaldo[0]?.saldo,
        offen: Number(agg?.offen ?? 0),
        anzahl: Number(agg?.anzahl ?? 0),
        letzteBuchung: agg?.letztesDatum ?? null,
        letzterImport: letzterImport[0] ?? null,
      });
    }
    return aus;
  }),

  /** Transaktionsliste mit Filtern. */
  liste: authedQuery
    .input(
      z.object({
        bankAccountId: z.number(),
        status: z.enum(["offen", "zugeordnet", "ignoriert", "alle"]).default("alle"),
        richtung: z.enum(["ein", "aus", "alle"]).default("alle"),
        von: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
        bis: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
        q: z.string().nullish(),
      }),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const bed = [eq(bankTransaktionen.bankAccountId, input.bankAccountId)];
      if (input.status !== "alle") bed.push(eq(bankTransaktionen.status, input.status));
      if (input.richtung === "ein") bed.push(gte(bankTransaktionen.betrag, "0.005"));
      if (input.richtung === "aus") bed.push(lte(bankTransaktionen.betrag, "-0.005"));
      if (input.von) bed.push(gte(bankTransaktionen.datum, input.von));
      if (input.bis) bed.push(lte(bankTransaktionen.datum, input.bis));
      if (input.q?.trim()) {
        const q = `%${input.q.trim()}%`;
        bed.push(sql`(${bankTransaktionen.name} LIKE ${q} OR ${bankTransaktionen.zweck} LIKE ${q})`);
      }
      const rows = await db
        .select({
          t: bankTransaktionen,
          rechnungNummer: invoices.nummer,
          rechnungKunde: invoices.kundeName,
          eingangNummer: incomingInvoices.nummer,
          eingangLieferant: incomingInvoices.lieferantName,
        })
        .from(bankTransaktionen)
        .leftJoin(invoices, eq(bankTransaktionen.invoiceId, invoices.id))
        .leftJoin(incomingInvoices, eq(bankTransaktionen.incomingInvoiceId, incomingInvoices.id))
        .where(and(...bed))
        .orderBy(desc(bankTransaktionen.datum), desc(bankTransaktionen.id))
        .limit(2000);
      return rows;
    }),

  /** Offene Ziele fuer den Zuordnungs-Dialog (Ausgangs- oder Eingangsrechnungen). */
  offeneZiele: authedQuery
    .input(z.object({ typ: z.enum(["ausgang", "eingang"]) }))
    .query(async ({ input }) => {
      const db = getDb();
      if (input.typ === "ausgang") {
        const rows = await db.select().from(invoices).where(eq(invoices.status, "finalisiert")).orderBy(desc(invoices.rechnungsdatum));
        return rows
          .map((r) => ({ id: r.id, nummer: r.nummer!, bezeichner: r.kundeName, datum: r.rechnungsdatum, offen: Number(r.brutto) - Number(r.bezahltBetrag) }))
          .filter((r) => r.offen > 0.004);
      }
      const rows = await db.select().from(incomingInvoices).where(isNull(incomingInvoices.bezahltAm)).orderBy(desc(incomingInvoices.rechnungsdatum));
      return rows.map((r) => ({ id: r.id, nummer: r.nummer, bezeichner: r.lieferantName, datum: r.rechnungsdatum, offen: Number(r.brutto) }));
    }),

  /** Manuell zuordnen (von der Transaktion aus). */
  zuordnen: authedQuery
    .input(z.object({ transaktionId: z.number(), typ: z.enum(["ausgang", "eingang"]), zielId: z.number() }))
    .mutation(async ({ input }) => {
      await zuordneIntern(input.transaktionId, input.typ, input.zielId);
      return { ok: true };
    }),

  /** Zuordnung wieder loesen — Zahlung wird zurueckgebucht. */
  zuordnungLoesen: authedQuery
    .input(z.object({ transaktionId: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const t = await db.query.bankTransaktionen.findFirst({ where: eq(bankTransaktionen.id, input.transaktionId) });
      if (!t) throw new Error("Transaktion nicht gefunden.");
      if (t.status !== "zugeordnet") throw new Error("Transaktion ist nicht zugeordnet.");
      const gebucht = Number(t.zugeordneterBetrag ?? 0);
      if (t.invoiceId && gebucht > 0) {
        const r = await db.query.invoices.findFirst({ where: eq(invoices.id, t.invoiceId) });
        if (r) {
          const neu = Math.max(0, Number(r.bezahltBetrag) - gebucht);
          await db
            .update(invoices)
            .set({ bezahltBetrag: neu.toFixed(2), bezahltAm: neu > 0.004 ? r.bezahltAm : null })
            .where(eq(invoices.id, r.id));
        }
      }
      if (t.incomingInvoiceId) {
        await db.update(incomingInvoices).set({ bezahltAm: null }).where(eq(incomingInvoices.id, t.incomingInvoiceId));
      }
      await db
        .update(bankTransaktionen)
        .set({ status: "offen", invoiceId: null, incomingInvoiceId: null, zugeordneterBetrag: null, zugeordnetAm: null })
        .where(eq(bankTransaktionen.id, t.id));
      return { ok: true };
    }),

  /** Ignorieren / wieder reaktivieren. */
  setStatus: authedQuery
    .input(z.object({ transaktionId: z.number(), status: z.enum(["offen", "ignoriert"]) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const t = await db.query.bankTransaktionen.findFirst({ where: eq(bankTransaktionen.id, input.transaktionId) });
      if (!t) throw new Error("Transaktion nicht gefunden.");
      if (t.status === "zugeordnet") throw new Error("Zugeordnete Transaktionen bitte zuerst loesen.");
      await db.update(bankTransaktionen).set({ status: input.status }).where(eq(bankTransaktionen.id, input.transaktionId));
      return { ok: true };
    }),

  /** Einzelne Transaktion loeschen (nur offen/ignoriert — Fehl-Importe). */
  loeschen: authedQuery
    .input(z.object({ transaktionId: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const t = await db.query.bankTransaktionen.findFirst({ where: eq(bankTransaktionen.id, input.transaktionId) });
      if (!t) throw new Error("Transaktion nicht gefunden.");
      if (t.status === "zugeordnet") throw new Error("Zugeordnete Transaktionen koennen nicht geloescht werden (GoBD) — erst loesen.");
      await db.delete(bankTransaktionen).where(eq(bankTransaktionen.id, input.transaktionId));
      return { ok: true };
    }),

  /** Ganze Import-Charge loeschen (nur wenn nichts davon zugeordnet ist). */
  importLoeschen: authedQuery
    .input(z.object({ importId: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const zugeordnet = await db
        .select({ id: bankTransaktionen.id })
        .from(bankTransaktionen)
        .where(and(eq(bankTransaktionen.importId, input.importId), eq(bankTransaktionen.status, "zugeordnet")))
        .limit(1);
      if (zugeordnet.length > 0) throw new Error("Aus diesem Import sind bereits Zahlungen verbucht — Import kann nicht geloescht werden.");
      await db.delete(bankTransaktionen).where(eq(bankTransaktionen.importId, input.importId));
      await db.delete(bankImporte).where(eq(bankImporte.id, input.importId));
      return { ok: true };
    }),

  /** Import-Historie je Konto. */
  importe: authedQuery
    .input(z.object({ bankAccountId: z.number() }))
    .query(async ({ input }) => {
      return getDb()
        .select()
        .from(bankImporte)
        .where(eq(bankImporte.bankAccountId, input.bankAccountId))
        .orderBy(desc(bankImporte.createdAt))
        .limit(50);
    }),

  /** Fuer die Rechnungsseite: passende offene Transaktionen (alle Konten). */
  offeneFuerRechnung: authedQuery
    .input(z.object({ invoiceId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const r = await db.query.invoices.findFirst({ where: eq(invoices.id, input.invoiceId) });
      if (!r) throw new Error("Rechnung nicht gefunden.");
      const offen = Number(r.brutto) - Number(r.bezahltBetrag);
      const rows = await db
        .select({ t: bankTransaktionen, kontoBezeichnung: bankAccounts.bezeichnung })
        .from(bankTransaktionen)
        .leftJoin(bankAccounts, eq(bankTransaktionen.bankAccountId, bankAccounts.id))
        .where(and(eq(bankTransaktionen.status, "offen"), gte(bankTransaktionen.betrag, "0.005")))
        .orderBy(desc(bankTransaktionen.datum))
        .limit(500);
      // Relevanz: Betrag passt exakt > Nummer im Text > Kundenname im Text > Rest
      const nr = r.nummer ?? "";
      const name = (r.kundeName ?? "").toLowerCase();
      const score = (t: typeof rows[number]["t"]) => {
        const betrag = Number(t.betrag);
        if (Math.abs(betrag - offen) <= 0.01) return 0;
        if (nr && ((t.zweck ?? "").includes(nr) || t.name.includes(nr))) return 1;
        if (name && (t.name.toLowerCase().includes(name.slice(0, 12)) || (t.zweck ?? "").toLowerCase().includes(name.slice(0, 12)))) return 2;
        return 3;
      };
      return rows
        .map((x) => ({ ...x, score: score(x.t) }))
        .sort((a, b) => a.score - b.score || (a.t.datum < b.t.datum ? 1 : -1))
        .slice(0, 30)
        .map((x) => ({ ...x, offenRechnung: offen }));
    }),

  /** Einzelne Transaktion per ID (fuer den Zuordnungs-Dialog). */
  einzelTx: authedQuery
    .input(z.object({ transaktionId: z.number() }))
    .query(async ({ input }) => {
      const t = await getDb().query.bankTransaktionen.findFirst({
        where: eq(bankTransaktionen.id, input.transaktionId),
      });
      if (!t) throw new Error("Transaktion nicht gefunden.");
      return t;
    }),

  /** Kontoauszug als PDF (base64, Browser-Download). */
  kontoauszugPdf: authedQuery
    .input(
      z.object({
        bankAccountId: z.number(),
        von: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
        bis: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
      }),
    )
    .query(async ({ input }) => {
      const { pdf, dateiname } = await erstelleKontoauszugPdf(
        input.bankAccountId,
        input.von ?? null,
        input.bis ?? null,
      );
      return { dateiname, base64: pdf.toString("base64") };
    }),

  /** Zugeordnete Transaktionen einer Rechnung (fuer Rechnungsdetail). */
  fuerRechnung: authedQuery
    .input(z.object({ invoiceId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      return db
        .select({ t: bankTransaktionen, kontoBezeichnung: bankAccounts.bezeichnung })
        .from(bankTransaktionen)
        .leftJoin(bankAccounts, eq(bankTransaktionen.bankAccountId, bankAccounts.id))
        .where(and(eq(bankTransaktionen.invoiceId, input.invoiceId), eq(bankTransaktionen.status, "zugeordnet")))
        .orderBy(asc(bankTransaktionen.datum));
    }),
});

/** Kern-Zuordnung mit Vorzeichen- und Statuspruefung. */
async function zuordneIntern(transaktionId: number, typ: "ausgang" | "eingang", zielId: number): Promise<void> {
  const db = getDb();
  const t = await db.query.bankTransaktionen.findFirst({ where: eq(bankTransaktionen.id, transaktionId) });
  if (!t) throw new Error("Transaktion nicht gefunden.");
  if (t.status === "zugeordnet") throw new Error("Transaktion ist bereits zugeordnet — erst loesen.");
  if (typ === "ausgang") {
    if (Number(t.betrag) <= 0) throw new Error("Nur Geldeingaenge koennen Ausgangsrechnungen zugeordnet werden.");
    const verbucht = await bucheAufRechnung(zielId, Number(t.betrag), t.datum);
    await db
      .update(bankTransaktionen)
      .set({ status: "zugeordnet", invoiceId: zielId, incomingInvoiceId: null, zugeordneterBetrag: verbucht.toFixed(2), zugeordnetAm: new Date() })
      .where(eq(bankTransaktionen.id, t.id));
  } else {
    if (Number(t.betrag) >= 0) throw new Error("Nur Ausgaenge koennen Eingangsrechnungen zugeordnet werden.");
    await bucheAufEingangsrechnung(zielId, t.datum);
    await db
      .update(bankTransaktionen)
      .set({ status: "zugeordnet", invoiceId: null, incomingInvoiceId: zielId, zugeordneterBetrag: Math.abs(Number(t.betrag)).toFixed(2), zugeordnetAm: new Date() })
      .where(eq(bankTransaktionen.id, t.id));
  }
}
