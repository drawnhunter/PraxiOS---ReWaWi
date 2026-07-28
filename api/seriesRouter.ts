// ── Serien-Rechnungen (wiederkehrende Belege) ──────────────────────────────
// Aus einer Rechnung als Serie speichern; wenn faellig, per Klick einen
// Entwurf erzeugen (GoBD: Nummer erst beim Finalisieren). Keine Stille
// Automatik — der Nutzer bestaetigt jede Erzeugung.
import { z } from "zod";
import { authedQuery, createRouter } from "./middleware";
import { getDb } from "./queries/connection";
import { invoiceSeries, invoices, invoiceItems, customers, companySettings, bankAccounts } from "@db/schema";
import { eq, desc } from "drizzle-orm";
import { computeTotals, centToDecimal } from "@contracts/invoicing";

const itemInput = z.object({
  bezeichnung: z.string().min(1),
  beschreibung: z.string().nullable().optional(),
  menge: z.string(),
  einheit: z.string().default("Stück"),
  einzelpreis: z.string(),
  ustSatz: z.number().int(),
});

function plusTage(iso: string, tage: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + tage);
  return d.toISOString().slice(0, 10);
}

export const seriesRouter = createRouter({
  list: authedQuery.query(async () => {
    const db = getDb();
    const [reihen, kundenListe] = await Promise.all([
      db.select().from(invoiceSeries).orderBy(desc(invoiceSeries.createdAt)),
      db.select().from(customers),
    ]);
    const kMap = new Map(kundenListe.map((k) => [k.id, k.name]));
    const heute = new Date().toISOString().slice(0, 10);
    return reihen.map((s) => ({
      ...s,
      kundeName: kMap.get(s.customerId) ?? "—",
      faellig: s.aktiv && s.naechsteFaellig <= heute,
    }));
  }),

  // Aus einer bestehenden Rechnung als Serie speichern
  ausRechnung: authedQuery
    .input(
      z.object({
        invoiceId: z.number(),
        titel: z.string().min(1).max(255),
        intervallTage: z.number().int().min(1).max(365),
        naechsteFaellig: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const r = await db.query.invoices.findFirst({
        where: eq(invoices.id, input.invoiceId),
        with: { items: true },
      });
      if (!r) throw new Error("Rechnung nicht gefunden.");
      await db.insert(invoiceSeries).values({
        customerId: r.customerId,
        titel: input.titel,
        intervallTage: input.intervallTage,
        naechsteFaellig: input.naechsteFaellig,
        itemsJson: JSON.stringify(
          r.items.map((it) => ({
            bezeichnung: it.bezeichnung,
            beschreibung: it.beschreibung,
            menge: it.menge,
            einheit: it.einheit,
            einzelpreis: it.einzelpreis,
            ustSatz: it.ustSatz,
          })),
        ),
        bemerkung: r.bemerkung,
      });
      return { ok: true };
    }),

  anlegen: authedQuery
    .input(
      z.object({
        customerId: z.number(),
        titel: z.string().min(1).max(255),
        intervallTage: z.number().int().min(1).max(365),
        naechsteFaellig: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        items: z.array(itemInput).min(1),
        bemerkung: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      await getDb().insert(invoiceSeries).values({
        customerId: input.customerId,
        titel: input.titel,
        intervallTage: input.intervallTage,
        naechsteFaellig: input.naechsteFaellig,
        itemsJson: JSON.stringify(input.items),
        bemerkung: input.bemerkung ?? null,
      });
      return { ok: true };
    }),

  // Entwurf aus der Serie erzeugen + naechstes Datum weiterzaehlen
  erzeugen: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const s = await db.query.invoiceSeries.findFirst({
        where: eq(invoiceSeries.id, input.id),
      });
      if (!s) throw new Error("Serie nicht gefunden.");
      const kunde = await db.query.customers.findFirst({
        where: eq(customers.id, s.customerId),
      });
      if (!kunde) throw new Error("Kunde der Serie existiert nicht mehr.");
      const settings = await db.query.companySettings.findFirst({
        where: eq(companySettings.id, 1),
      });
      const standardBank = await db.query.bankAccounts.findFirst({
        where: eq(bankAccounts.istStandard, true),
      });

      const items = JSON.parse(s.itemsJson) as z.infer<typeof itemInput>[];
      const totals = computeTotals(items.map((it) => ({ ...it, beschreibung: it.beschreibung ?? null })));
      const heute = new Date().toISOString().slice(0, 10);
      const ziel = kunde.zahlungszielTage ?? settings?.standardZahlungsziel ?? 14;

      const [res] = await db.insert(invoices).values({
        customerId: s.customerId,
        status: "entwurf",
        rechnungsdatum: heute,
        faelligkeitsdatum: plusTage(heute, ziel),
        kundeName: kunde.name,
        kundeZusatz: kunde.zusatz,
        kundeStrasse: kunde.strasse,
        kundePlz: kunde.plz,
        kundeOrt: kunde.ort,
        kundeLand: kunde.land,
        netto: centToDecimal(totals.nettoCent),
        ust: centToDecimal(totals.ustCent),
        brutto: centToDecimal(totals.bruttoCent),
        bezahltBetrag: "0",
        bankAccountId: standardBank?.id ?? null,
        bemerkung: s.bemerkung ?? s.titel,
      }).$returningId();

      await db.insert(invoiceItems).values(
        items.map((it, i) => ({
          invoiceId: res.id,
          position: i + 1,
          bezeichnung: it.bezeichnung,
          beschreibung: it.beschreibung ?? null,
          menge: it.menge,
          einheit: it.einheit,
          einzelpreis: it.einzelpreis,
          ustSatz: it.ustSatz,
        })),
      );

      await db
        .update(invoiceSeries)
        .set({ naechsteFaellig: plusTage(s.naechsteFaellig, s.intervallTage) })
        .where(eq(invoiceSeries.id, s.id));

      return { invoiceId: res.id, naechsteFaellig: plusTage(s.naechsteFaellig, s.intervallTage) };
    }),

  setAktiv: authedQuery
    .input(z.object({ id: z.number(), aktiv: z.boolean() }))
    .mutation(async ({ input }) => {
      await getDb()
        .update(invoiceSeries)
        .set({ aktiv: input.aktiv })
        .where(eq(invoiceSeries.id, input.id));
      return { ok: true };
    }),

  loeschen: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await getDb().delete(invoiceSeries).where(eq(invoiceSeries.id, input.id));
      return { ok: true };
    }),

  faelligAnzahl: authedQuery.query(async () => {
    const reihen = await getDb().select().from(invoiceSeries);
    const heute = new Date().toISOString().slice(0, 10);
    return { anzahl: reihen.filter((s) => s.aktiv && s.naechsteFaellig <= heute).length };
  }),
});
