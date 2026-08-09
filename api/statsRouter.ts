// Statistik-Auswertungen (nur finalisierte Rechnungen; Entwuerfe und
// Stornos fliessen nicht ein). Datenmengen sind klein — die Aggregation
// erfolgt bewusst im Speicher statt in SQL.
import { eq } from "drizzle-orm";
import { z } from "zod";
import { authedQuery, createRouter } from "./middleware";
import { getDb } from "./queries/connection";
import { invoices, invoiceItems, incomingInvoices } from "@db/schema";

const zodMonat = z.object({ monat: z.string().regex(/^\d{4}-\d{2}$/) });

export const statsRouter = createRouter({
  uebersicht: authedQuery.query(async () => {
    const db = getDb();
    const finale = await db.select().from(invoices).where(eq(invoices.status, "finalisiert"));

    const heute = new Date().toISOString().slice(0, 10);
    const jahr = heute.slice(0, 4);
    const monat = heute.slice(0, 7);
    const summe = (arr: typeof finale, f: (r: (typeof finale)[number]) => number) =>
      arr.reduce((a, r) => a + f(r), 0);

    const imJahr = finale.filter((r) => r.rechnungsdatum.startsWith(jahr));
    const imMonat = finale.filter((r) => r.rechnungsdatum.startsWith(monat));
    const offenPosten = finale.filter(
      (r) => Number(r.brutto) - Number(r.bezahltBetrag) > 0.004,
    );
    const ueberfaellig = offenPosten.filter((r) => r.faelligkeitsdatum < heute);

    return {
      umsatzJahrNetto: summe(imJahr, (r) => Number(r.netto)),
      zahlungseingaengeJahr: summe(imJahr, (r) => Number(r.bezahltBetrag)),
      umsatzMonatNetto: summe(imMonat, (r) => Number(r.netto)),
      anzahlJahr: imJahr.length,
      anzahlGesamt: finale.length,
      schnittBetrag:
        imJahr.length > 0 ? summe(imJahr, (r) => Number(r.brutto)) / imJahr.length : 0,
      offenAnzahl: offenPosten.length,
      offenBetrag: summe(offenPosten, (r) => Number(r.brutto) - Number(r.bezahltBetrag)),
      ueberfaelligAnzahl: ueberfaellig.length,
      ueberfaelligBetrag: summe(
        ueberfaellig,
        (r) => Number(r.brutto) - Number(r.bezahltBetrag),
      ),
    };
  }),

  verlauf: authedQuery.query(async () => {
    const finale = await getDb()
      .select()
      .from(invoices)
      .where(eq(invoices.status, "finalisiert"));

    const monate = new Map<string, { umsatz: number; zahlungen: number; anzahl: number }>();
    const eintrag = (key: string) => {
      if (!monate.has(key)) monate.set(key, { umsatz: 0, zahlungen: 0, anzahl: 0 });
      return monate.get(key)!;
    };

    for (const r of finale) {
      const m = eintrag(r.rechnungsdatum.slice(0, 7));
      m.umsatz += Number(r.netto);
      m.anzahl += 1;
      if (r.bezahltAm && Number(r.bezahltBetrag) > 0) {
        eintrag(r.bezahltAm.slice(0, 7)).zahlungen += Number(r.bezahltBetrag);
      }
    }

    // letzte 12 Kalendermonate auffuellen
    const out: { monat: string; label: string; umsatz: number; zahlungen: number; anzahl: number }[] = [];
    const jetzt = new Date();
    for (let i = 11; i >= 0; i--) {
      const dt = new Date(jetzt.getFullYear(), jetzt.getMonth() - i, 1);
      const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
      const label = dt.toLocaleDateString("de-DE", { month: "short", year: "2-digit" });
      out.push({ monat: key, label, ...(monate.get(key) ?? { umsatz: 0, zahlungen: 0, anzahl: 0 }) });
    }
    return out;
  }),

  top: authedQuery.query(async () => {
    const db = getDb();
    const finale = await db.select().from(invoices).where(eq(invoices.status, "finalisiert"));
    const items = await db.select().from(invoiceItems);
    const finaleIds = new Set(finale.map((r) => r.id));

    // Top-Kunden nach Umsatz (netto)
    const kundenMap = new Map<string, { umsatz: number; anzahl: number }>();
    for (const r of finale) {
      const e = kundenMap.get(r.kundeName) ?? { umsatz: 0, anzahl: 0 };
      e.umsatz += Number(r.netto);
      e.anzahl += 1;
      kundenMap.set(r.kundeName, e);
    }
    const kunden = [...kundenMap.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.umsatz - a.umsatz)
      .slice(0, 8);

    // Top-Produkte nach Umsatz (netto)
    const produktMap = new Map<string, { umsatz: number; menge: number }>();
    for (const it of items) {
      if (!finaleIds.has(it.invoiceId)) continue;
      const e = produktMap.get(it.bezeichnung) ?? { umsatz: 0, menge: 0 };
      e.umsatz += Number(it.menge) * Number(it.einzelpreis);
      e.menge += Number(it.menge);
      produktMap.set(it.bezeichnung, e);
    }
    const produkte = [...produktMap.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.umsatz - a.umsatz)
      .slice(0, 8);

    // Umsatzsteuer nach Satz (aus den Rechnungssummen)
    const ustMap = new Map<number, { basis: number; betrag: number }>();
    for (const r of finale) {
      const netto = Number(r.netto);
      const brutto = Number(r.brutto);
      const ust = brutto - netto;
      // Satz aus den Positionen bestimmen (dominanter Satz der Rechnung)
      const pos = items.filter((it) => it.invoiceId === r.id);
      const saetze = new Set(pos.map((it) => it.ustSatz));
      const satz = saetze.size === 1 ? [...saetze][0] : -1; // -1 = gemischt
      const e = ustMap.get(satz) ?? { basis: 0, betrag: 0 };
      e.basis += netto;
      e.betrag += ust;
      ustMap.set(satz, e);
    }
    const ust = [...ustMap.entries()]
      .map(([satz, v]) => ({ satz, ...v }))
      .sort((a, b) => b.basis - a.basis);

    return { kunden, produkte, ust };
  }),

  // UStVA-Hilfsblatt: Umsatzsteuer (Ausgangsrechnungen) minus Vorsteuer
  // (Eingangsrechnungen) je Monat — Werte zum Uebertragen in Mein ELSTER.
  ustva: authedQuery
    .input(zodMonat)
    .query(async ({ input }) => {
      const db = getDb();
      const monat = input.monat; // JJJJ-MM

      const ausgaben = await db
        .select()
        .from(invoices)
        .where(eq(invoices.status, "finalisiert"));
      const imMonat = ausgaben.filter((r) => r.rechnungsdatum.startsWith(monat));
      const items = await db.select().from(invoiceItems);
      const ausMap = new Map<number, { basis: number; ust: number }>();
      for (const r of imMonat) {
        const pos = items.filter((it) => it.invoiceId === r.id);
        const saetze = new Set(pos.map((it) => it.ustSatz));
        const satz = saetze.size === 1 ? [...saetze][0] : -1;
        const netto = Number(r.netto);
        const ust = Number(r.brutto) - netto;
        const e = ausMap.get(satz) ?? { basis: 0, ust: 0 };
        e.basis += netto;
        e.ust += ust;
        ausMap.set(satz, e);
      }

      const eingehende = await db.select().from(incomingInvoices);
      const einMonat = eingehende.filter((r) => r.rechnungsdatum.startsWith(monat));
      const vorMap = new Map<number, { basis: number; ust: number }>();
      for (const r of einMonat) {
        let saetze = new Set<number>();
        try {
          const pos = JSON.parse(r.positionenJson ?? "[]") as { ustSatz: number }[];
          saetze = new Set(pos.map((p) => p.ustSatz));
        } catch { /* egal */ }
        const satz = saetze.size === 1 ? [...saetze][0] : -1;
        const netto = Number(r.netto);
        const ust = Number(r.ust);
        const e = vorMap.get(satz) ?? { basis: 0, ust: 0 };
        e.basis += netto;
        e.ust += ust;
        vorMap.set(satz, e);
      }

      const zuListe = (m: Map<number, { basis: number; ust: number }>) =>
        [...m.entries()]
          .map(([satz, v]) => ({ satz, basis: v.basis, ust: v.ust }))
          .sort((a, b) => b.basis - a.basis);

      const ustGesamt = [...ausMap.values()].reduce((a, v) => a + v.ust, 0);
      const vorGesamt = [...vorMap.values()].reduce((a, v) => a + v.ust, 0);

      return {
        monat,
        ausgangsrechnungen: zuListe(ausMap),
        eingangsrechnungen: zuListe(vorMap),
        umsatzsteuer: ustGesamt,
        vorsteuer: vorGesamt,
        zahllast: ustGesamt - vorGesamt,
      };
    }),
});
