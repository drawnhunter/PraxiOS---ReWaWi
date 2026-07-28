// ── Eingangsrechnungen (empfangene E-Rechnungen) ───────────────────────────
import { z } from "zod";
import { authedQuery, createRouter } from "./middleware";
import { getDb } from "./queries/connection";
import { incomingInvoices } from "@db/schema";
import { eq, desc } from "drizzle-orm";
import { analysiereXrechnung } from "./xrechnungEinlesen";
import { extrahiereXmlAusPdf } from "./zugferdPdf";

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
    const { daten, fehler } = analysiereXrechnung(input.xml);
    if (fehler.length > 0 || !daten) {
      throw new Error(`Keine buchbare E-Rechnung: ${fehler.join("; ")}`);
    }
    if (!daten.datum) throw new Error("Rechnungsdatum fehlt — kann nicht gebucht werden.");
    const dup = await duplikat(daten.lieferant, daten.nummer);
    if (dup) {
      throw new Error(`„${daten.nummer}" von ${daten.lieferant} wurde bereits importiert.`);
    }
    const [res] = await getDb().insert(incomingInvoices).values({
      lieferantName: daten.lieferant,
      lieferantKennung: daten.lieferantKennung,
      nummer: daten.nummer,
      rechnungsdatum: daten.datum,
      faelligkeitsdatum: daten.faellig,
      netto: daten.netto.toFixed(2),
      ust: daten.ust.toFixed(2),
      brutto: daten.brutto.toFixed(2),
      waehrung: daten.waehrung,
      positionenJson: JSON.stringify(daten.positionen),
      originalXml: input.xml,
    }).$returningId();
    return { id: res.id };
  }),

  list: authedQuery.query(async () => {
    return getDb()
      .select({
        id: incomingInvoices.id,
        lieferantName: incomingInvoices.lieferantName,
        nummer: incomingInvoices.nummer,
        rechnungsdatum: incomingInvoices.rechnungsdatum,
        faelligkeitsdatum: incomingInvoices.faelligkeitsdatum,
        brutto: incomingInvoices.brutto,
        waehrung: incomingInvoices.waehrung,
        bezahltAm: incomingInvoices.bezahltAm,
        createdAt: incomingInvoices.createdAt,
      })
      .from(incomingInvoices)
      .orderBy(desc(incomingInvoices.rechnungsdatum), desc(incomingInvoices.id));
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
