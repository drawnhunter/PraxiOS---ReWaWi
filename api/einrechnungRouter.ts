// ── Eingangsrechnungen (empfangene E-Rechnungen) ───────────────────────────
import { z } from "zod";
import { authedQuery, createRouter } from "./middleware";
import { getDb } from "./queries/connection";
import { incomingInvoices } from "@db/schema";
import { eq, desc } from "drizzle-orm";
import { analysiereXrechnung } from "./xrechnungEinlesen";
import { extrahiereXmlAusPdf } from "./zugferdPdf";
import { bucheEingangsrechnungAusXml } from "./lib/einrechnung";

const xmlInput = z.object({ xml: z.string().min(20) });

async function duplikat(lieferant: string, nummer: string) {
  const treffer = await getDb().query.incomingInvoices.findFirst({
    where: (t, { eq: e, and: a }) => a(e(t.lieferantName, lieferant), e(t.nummer, nummer)),
  });
  return treffer ?? null;
}

export const einrechnungRouter = createRouter({
  // ZUGFeRD/Factur-X: PDF mit eingebettetem XML — extrahiert und analysiert
  analysierenPdf: authedQuery
    .input(z.object({ pdfBase64: z.string().min(100) }))
    .mutation(async ({ input }) => {
      const pdf = Buffer.from(input.pdfBase64, "base64");
      const xml = extrahiereXmlAusPdf(pdf);
      if (!xml) {
        throw new Error("Keine eingebettete XML in der PDF gefunden — ist das eine ZUGFeRD/Factur-X-Datei?");
      }
      const { daten, fehler, warnungen } = analysiereXrechnung(xml);
      if (fehler.length > 0 || !daten) return { ok: false as const, fehler, warnungen, xml };
      const dup = await duplikat(daten.lieferant, daten.nummer);
      return {
        ok: true as const,
        daten,
        fehler,
        warnungen,
        duplikat: dup ? { id: dup.id } : null,
        xml,
      };
    }),

  analysieren: authedQuery.input(xmlInput).mutation(async ({ input }) => {
    const { daten, fehler, warnungen } = analysiereXrechnung(input.xml);
    if (fehler.length > 0 || !daten) return { ok: false as const, fehler, warnungen };
    const dup = await duplikat(daten.lieferant, daten.nummer);
    return {
      ok: true as const,
      daten,
      fehler,
      warnungen,
      duplikat: dup ? { id: dup.id } : null,
    };
  }),

  buchen: authedQuery.input(xmlInput).mutation(async ({ input }) => {
    const { id } = await bucheEingangsrechnungAusXml(input.xml);
    return { id };
  }),

  list: authedQuery.query(async () => {
    return getDb()
      .select({
        id: incomingInvoices.id,
        lieferantName: incomingInvoices.lieferantName,
        nummer: incomingInvoices.nummer,
        rechnungsdatum: incomingInvoices.rechnungsdatum,
        faelligkeitsdatum: incomingInvoices.faelligkeitsdatum,
        netto: incomingInvoices.netto,
        ust: incomingInvoices.ust,
        brutto: incomingInvoices.brutto,
        waehrung: incomingInvoices.waehrung,
        konto: incomingInvoices.konto,
        gegenkonto: incomingInvoices.gegenkonto,
        bezahltAm: incomingInvoices.bezahltAm,
        freigabe: incomingInvoices.freigabe,
        freigegebenVon: incomingInvoices.freigegebenVon,
        createdAt: incomingInvoices.createdAt,
      })
      .from(incomingInvoices)
      .orderBy(desc(incomingInvoices.rechnungsdatum), desc(incomingInvoices.id));
  }),

  /**
   * Beleg hochladen (Bulk-UI): Datei → Eingangsrechnung mit OCR-Auto-Extraktion
   * (Betrag/Datum/Lieferant/Nummer vorbefüllt, Konfidenz-Schwellen). Jede Datei
   * einzeln aufrufen — die UI batcht und zeigt Fortschritt.
   */
  hochladen: authedQuery
    .input(z.object({
      dateiname: z.string().min(1).max(255),
      base64: z.string().min(1),
      mime: z.string().min(1).max(60),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { incomingInvoices, companySettings } = await import("@db/schema");
      const dezimal = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));
      let lieferant = input.dateiname.replace(/\.(pdf|jpe?g|png)$/i, "").slice(0, 255);
      let datum = new Date().toISOString().slice(0, 10);
      let nummer: string | null = null;
      let nettoS = "0.00", ustS = "0.00", bruttoS = "0.00";
      let auto = "";
      let ocrText: string | null = null;

      try {
        const { extrahiereAnhangText } = await import("./lib/anhangText");
        const { extrahiereBelegFelder } = await import("./lib/belegExtraktion");
        const text = await extrahiereAnhangText(Buffer.from(input.base64, "base64"), input.mime);
        if (text.ok && text.text) {
          ocrText = text.text.slice(0, 2_000_000);
          const f = extrahiereBelegFelder(text.text);
          if (f.brutto && f.brutto.konfidenz >= 0.7) {
            const brutto = dezimal(f.brutto.wert);
            bruttoS = brutto.toFixed(2);
            if (f.mwst) {
              ustS = dezimal(f.mwst.wert).toFixed(2);
              nettoS = (brutto - dezimal(f.mwst.wert)).toFixed(2);
            } else {
              nettoS = (brutto / 1.19).toFixed(2);
              ustS = (brutto - brutto / 1.19).toFixed(2);
            }
            auto += `Betrag ${f.brutto.wert} € erkannt. `;
          }
          if (f.datum && f.datum.konfidenz >= 0.8) datum = f.datum.wert;
          if (f.lieferant && f.lieferant.konfidenz >= 0.6) lieferant = f.lieferant.wert.slice(0, 255);
          if (f.nummer && f.nummer.konfidenz >= 0.8) { nummer = f.nummer.wert.slice(0, 100); auto += `Nr. ${f.nummer.wert} erkannt. `; }
          if (!auto) auto = "Keine Felder sicher erkannt (manuell prüfen). ";
        } else {
          auto = "Kein lesbarer Text (schlechter Scan) — manuell ausfüllen. ";
        }
      } catch { auto = "Extraktion fehlgeschlagen — manuell ausfüllen. "; }

      if (!nummer) nummer = `HOCH-${datum.replaceAll("-", "")}-${Math.random().toString(36).slice(2, 8)}`;
      const duplikat = await db.query.incomingInvoices.findFirst({
        where: (t, { and: a, eq: e }) => a(e(t.lieferantName, lieferant), e(t.nummer, nummer!)),
      });
      if (duplikat) {
        return { ok: false, fehler: `Bereits vorhanden (Beleg #${duplikat.id}, ${lieferant} ${nummer}).`, duplikatId: duplikat.id };
      }

      const s = await db.query.companySettings.findFirst({ where: eq(companySettings.id, 1) });
      const [{ id }] = await db
        .insert(incomingInvoices)
        .values({
          lieferantName: lieferant,
          nummer,
          rechnungsdatum: datum,
          netto: nettoS,
          ust: ustS,
          brutto: bruttoS,
          konto: s?.aufwandskontoDefault ?? "4900",
          belegBase64: input.base64,
          belegMime: input.mime,
          ocrText,
          bemerkung: `Hochgeladen (${input.dateiname}). ${auto}`.trim(),
        })
        .$returningId();
      return { ok: true, id, lieferant, nummer, datum, brutto: bruttoS, auto: auto.trim() };
    }),

  /** Beleg-Freigabe light: neu → geprueft → freigegeben (Mandant). */
  freigabeSetzen: authedQuery
    .input(z.object({
      id: z.number(),
      zustand: z.enum(["neu", "geprueft", "freigegeben"]),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const r = await db.query.incomingInvoices.findFirst({ where: eq(incomingInvoices.id, input.id) });
      if (!r) throw new Error("Eingangsrechnung nicht gefunden.");
      const von = ctx.user?.username ?? ctx.user?.name ?? "unbekannt";
      await db
        .update(incomingInvoices)
        .set({
          freigabe: input.zustand,
          freigegebenAm: input.zustand === "freigegeben" ? new Date() : null,
          freigegebenVon: input.zustand === "neu" ? null : von,
        })
        .where(eq(incomingInvoices.id, input.id));
      return { ok: true, zustand: input.zustand };
    }),

  get: authedQuery.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const r = await getDb().query.incomingInvoices.findFirst({
      where: eq(incomingInvoices.id, input.id),
    });
    if (!r) throw new Error("Eingangsrechnung nicht gefunden.");
    return r;
  }),

  xml: authedQuery.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const r = await getDb().query.incomingInvoices.findFirst({
      where: eq(incomingInvoices.id, input.id),
    });
    if (!r?.originalXml) throw new Error("Kein XML archiviert.");
    return { dateiname: `E-Rechnung ${r.lieferantName} ${r.nummer}.xml`, xml: r.originalXml };
  }),

  markPaid: authedQuery
    .input(z.object({ id: z.number(), datum: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }))
    .mutation(async ({ input }) => {
      await getDb()
        .update(incomingInvoices)
        .set({ bezahltAm: input.datum ?? new Date().toISOString().slice(0, 10) })
        .where(eq(incomingInvoices.id, input.id));
      return { ok: true };
    }),

  unmarkPaid: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await getDb()
        .update(incomingInvoices)
        .set({ bezahltAm: null })
        .where(eq(incomingInvoices.id, input.id));
      return { ok: true };
    }),
});
