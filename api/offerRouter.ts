import { z } from "zod";
import { authedQuery, createRouter } from "./middleware";
import { getDb } from "./queries/connection";
import {
  offers,
  offerItems,
  customers,
  companySettings,
} from "@db/schema";
import { eq, desc } from "drizzle-orm";
import {
  computeTotals,
  centToDecimal,
  nextNumber,
} from "./queries/invoicing";

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format: JJJJ-MM-TT");

const itemInput = z.object({
  bezeichnung: z.string().min(1),
  beschreibung: z.string().nullable().optional(),
  menge: z.string().regex(/^\d+(\.\d{1,3})?$/, "Menge mit max. 3 Dezimalstellen"),
  einheit: z.string().min(1).default("Stück"),
  einzelpreis: z.string().regex(/^-?\d+(\.\d{1,2})?$/, "Preis mit max. 2 Dezimalstellen"),
  ustSatz: z.number().int().refine((v) => [19, 7, 0].includes(v), "Nur 19 %, 7 % oder 0 %"),
});

const kopfInput = z.object({
  customerId: z.number(),
  datum: dateString,
  gueltigBis: dateString.nullable().optional(),
  kundeName: z.string().min(1),
  kundeZusatz: z.string().nullable().optional(),
  kundeStrasse: z.string().min(1),
  kundePlz: z.string().min(1),
  kundeOrt: z.string().min(1),
  kundeLand: z.string().default("Deutschland"),
  pdfNotiz: z.string().nullable().optional(),
  bemerkung: z.string().nullable().optional(),
});

async function ladeAngebot(id: number) {
  const a = await getDb().query.offers.findFirst({
    where: eq(offers.id, id),
    with: { items: true, customer: true },
  });
  if (a?.items) a.items.sort((x, y) => x.position - y.position);
  return a;
}

export const offerRouter = createRouter({
  list: authedQuery.query(async () => {
    return getDb().query.offers.findMany({
      orderBy: [desc(offers.datum), desc(offers.id)],
    });
  }),

  get: authedQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const a = await ladeAngebot(input.id);
      if (!a) throw new Error("Angebot nicht gefunden.");
      return a;
    }),

  createDraft: authedQuery
    .input(z.object({ customerId: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const kunde = await db.query.customers.findFirst({
        where: eq(customers.id, input.customerId),
      });
      if (!kunde) throw new Error("Kunde nicht gefunden.");

      const heute = new Date();
      const gueltig = new Date(heute);
      gueltig.setDate(gueltig.getDate() + 30);
      const fmt = (d: Date) => d.toISOString().slice(0, 10);

      const [{ id }] = await db
        .insert(offers)
        .values({
          customerId: kunde.id,
          datum: fmt(heute),
          gueltigBis: fmt(gueltig),
          kundeName: kunde.name,
          kundeZusatz: kunde.zusatz,
          kundeStrasse: kunde.strasse,
          kundePlz: kunde.plz,
          kundeOrt: kunde.ort,
          kundeLand: kunde.land,
        })
        .$returningId();
      return { id };
    }),

  updateDraft: authedQuery
    .input(z.object({ id: z.number(), kopf: kopfInput, items: z.array(itemInput) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const angebot = await db.query.offers.findFirst({
        where: eq(offers.id, input.id),
      });
      if (!angebot) throw new Error("Angebot nicht gefunden.");
      if (angebot.status !== "entwurf") {
        throw new Error("Nur Entwürfe können bearbeitet werden.");
      }

      const totals = computeTotals(input.items);

      await db.transaction(async (tx) => {
        await tx
          .update(offers)
          .set({
            ...input.kopf,
            gueltigBis: input.kopf.gueltigBis ?? null,
            pdfNotiz: input.kopf.pdfNotiz ?? null,
            netto: centToDecimal(totals.nettoCent),
            ust: centToDecimal(totals.ustCent),
            brutto: centToDecimal(totals.bruttoCent),
          })
          .where(eq(offers.id, input.id));

        await tx.delete(offerItems).where(eq(offerItems.offerId, input.id));
        if (input.items.length > 0) {
          await tx.insert(offerItems).values(
            input.items.map((it, i) => ({
              offerId: input.id,
              position: i + 1,
              bezeichnung: it.bezeichnung,
              beschreibung: it.beschreibung ?? null,
              menge: it.menge,
              einheit: it.einheit,
              einzelpreis: it.einzelpreis,
              ustSatz: it.ustSatz,
            })),
          );
        }
      });
      return { ok: true };
    }),

  /** Finalisieren: Nummer A-JJJJ-NNN vergeben, Firmendaten einfrieren. */
  finalize: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const angebot = await db.query.offers.findFirst({
        where: eq(offers.id, input.id),
        with: { items: true },
      });
      if (!angebot) throw new Error("Angebot nicht gefunden.");
      if (angebot.status !== "entwurf") throw new Error("Angebot ist bereits finalisiert.");
      if (angebot.items.length === 0) {
        throw new Error("Ein Angebot ohne Positionen kann nicht finalisiert werden.");
      }

      const settings = await db.query.companySettings.findFirst({
        where: eq(companySettings.id, 1),
      });
      if (!settings) throw new Error("Firmen-Einstellungen fehlen.");

      const jahr = Number(angebot.datum.slice(0, 4));
      const firmenSnapshot = JSON.stringify({
        name: settings.name,
        strasse: settings.strasse,
        plz: settings.plz,
        ort: settings.ort,
        land: settings.land,
        handelsregister: settings.handelsregister,
        steuernummer: settings.steuernummer,
        ustIdNr: settings.ustIdNr,
        email: settings.email,
        telefon: settings.telefon,
        webseite: settings.webseite,
        fussText: settings.fussText,
      });

      const nummer = await db.transaction(async (tx) => {
        const n = await nextNumber(tx, "offer", jahr);
        const nr = `A-${jahr}-${String(n).padStart(3, "0")}`;
        await tx
          .update(offers)
          .set({
            nummer: nr,
            status: "finalisiert",
            finalizedAt: new Date(),
            firmenSnapshot,
          })
          .where(eq(offers.id, input.id));
        return nr;
      });

      return { nummer };
    }),

  /** Angebot in Rechnungsentwurf umwandeln (Positionen + Kundendaten kopieren). */
  umwandeln: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const a = await ladeAngebot(input.id);
      if (!a) throw new Error("Angebot nicht gefunden.");
      if (a.status !== "finalisiert") {
        throw new Error("Nur finalisierte Angebote können umgewandelt werden.");
      }
      if (a.convertedInvoiceId) {
        throw new Error("Angebot wurde bereits umgewandelt.");
      }

      const { invoices, invoiceItems } = await import("@db/schema");
      const heute = new Date();
      const kunde = await db.query.customers.findFirst({
        where: eq(customers.id, a.customerId),
      });
      const settings = await db.query.companySettings.findFirst({
        where: eq(companySettings.id, 1),
      });
      const zielTage = kunde?.zahlungszielTage ?? settings?.standardZahlungsziel ?? 14;
      const faellig = new Date(heute);
      faellig.setDate(faellig.getDate() + zielTage);
      const fmt = (d: Date) => d.toISOString().slice(0, 10);

      const rechnungId = await db.transaction(async (tx) => {
        const [{ id: rid }] = await tx
          .insert(invoices)
          .values({
            customerId: a.customerId,
            rechnungsdatum: fmt(heute),
            faelligkeitsdatum: fmt(faellig),
            kundeName: a.kundeName,
            kundeZusatz: a.kundeZusatz,
            kundeStrasse: a.kundeStrasse,
            kundePlz: a.kundePlz,
            kundeOrt: a.kundeOrt,
            kundeLand: a.kundeLand,
            netto: a.netto,
            ust: a.ust,
            brutto: a.brutto,
            bemerkung: `Aus Angebot ${a.nummer ?? a.id} erstellt`,
          })
          .$returningId();

        if (a.items.length > 0) {
          await tx.insert(invoiceItems).values(
            a.items.map((it, i) => ({
              invoiceId: rid,
              position: i + 1,
              bezeichnung: it.bezeichnung,
              beschreibung: it.beschreibung,
              menge: it.menge,
              einheit: it.einheit,
              einzelpreis: it.einzelpreis,
              ustSatz: it.ustSatz,
            })),
          );
        }

        await tx
          .update(offers)
          .set({ status: "umgewandelt", convertedInvoiceId: rid })
          .where(eq(offers.id, input.id));
        return rid;
      });

      return { invoiceId: rechnungId };
    }),

  stornieren: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const a = await db.query.offers.findFirst({ where: eq(offers.id, input.id) });
      if (!a) throw new Error("Angebot nicht gefunden.");
      if (a.status === "umgewandelt") {
        throw new Error("Bereits umgewandelte Angebote können nicht storniert werden.");
      }
      await db.update(offers).set({ status: "storniert" }).where(eq(offers.id, input.id));
      return { ok: true };
    }),

  delete: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const a = await db.query.offers.findFirst({ where: eq(offers.id, input.id) });
      if (!a) throw new Error("Angebot nicht gefunden.");
      if (a.status !== "entwurf") {
        throw new Error("Nur Entwürfe können gelöscht werden.");
      }
      await db.delete(offerItems).where(eq(offerItems.offerId, input.id));
      await db.delete(offers).where(eq(offers.id, input.id));
      return { ok: true };
    }),
});
