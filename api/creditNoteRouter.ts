import { z } from "zod";
import { authedQuery, createRouter } from "./middleware";
import { getDb } from "./queries/connection";
import {
  creditNotes,
  creditNoteItems,
  invoices,
  companySettings,
} from "@db/schema";
import { eq, desc } from "drizzle-orm";
import {
  computeTotals,
  centToDecimal,
  nextNumber,
  formatCreditNoteNumber,
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
  datum: dateString,
  grund: z.string().nullable().optional(),
  kundeName: z.string().min(1),
  kundeZusatz: z.string().nullable().optional(),
  kundeStrasse: z.string().min(1),
  kundePlz: z.string().min(1),
  kundeOrt: z.string().min(1),
  kundeLand: z.string().default("Deutschland"),
});

async function ladeGutschriftMitDetails(id: number) {
  const db = getDb();
  const gutschrift = await db.query.creditNotes.findFirst({
    where: eq(creditNotes.id, id),
    with: { items: true, invoice: true },
  });
  if (gutschrift?.items) {
    gutschrift.items.sort((a, b) => a.position - b.position);
  }
  return gutschrift;
}

export const creditNoteRouter = createRouter({
  list: authedQuery.query(async () => {
    return getDb().query.creditNotes.findMany({
      orderBy: [desc(creditNotes.createdAt)],
      with: { invoice: true },
    });
  }),

  get: authedQuery
    .input(z.object({ id: z.number() }))
    .query(({ input }) => ladeGutschriftMitDetails(input.id)),

  updateDraft: authedQuery
    .input(z.object({ id: z.number(), kopf: kopfInput, items: z.array(itemInput) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const gutschrift = await db.query.creditNotes.findFirst({
        where: eq(creditNotes.id, input.id),
      });
      if (!gutschrift) throw new Error("Gutschrift nicht gefunden.");
      if (gutschrift.status !== "entwurf") {
        throw new Error("Nur Entwürfe können bearbeitet werden (GoBD).");
      }

      const totals = computeTotals(input.items);

      await db.transaction(async (tx) => {
        await tx
          .update(creditNotes)
          .set({
            ...input.kopf,
            grund: input.kopf.grund ?? null,
            netto: centToDecimal(totals.nettoCent),
            ust: centToDecimal(totals.ustCent),
            brutto: centToDecimal(totals.bruttoCent),
          })
          .where(eq(creditNotes.id, input.id));

        await tx
          .delete(creditNoteItems)
          .where(eq(creditNoteItems.creditNoteId, input.id));
        if (input.items.length > 0) {
          await tx.insert(creditNoteItems).values(
            input.items.map((it, i) => ({
              creditNoteId: input.id,
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

  /** Finalisieren: ST-Nummer vergeben. Bei Vollstorno wird die Rechnung storniert. */
  finalize: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const gutschrift = await db.query.creditNotes.findFirst({
        where: eq(creditNotes.id, input.id),
        with: { items: true, invoice: true },
      });
      if (!gutschrift) throw new Error("Gutschrift nicht gefunden.");
      if (gutschrift.status !== "entwurf") throw new Error("Gutschrift ist bereits finalisiert.");
      if (gutschrift.items.length === 0) {
        throw new Error("Eine Gutschrift ohne Positionen kann nicht finalisiert werden.");
      }

      const settings = await db.query.companySettings.findFirst({
        where: eq(companySettings.id, 1),
      });
      if (!settings) throw new Error("Firmen-Einstellungen fehlen.");

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
        const n = await nextNumber(tx, "credit_note", 0);
        const nr = formatCreditNoteNumber(n);
        await tx
          .update(creditNotes)
          .set({
            nummer: nr,
            status: "finalisiert",
            finalizedAt: new Date(),
            firmenSnapshot,
          })
          .where(eq(creditNotes.id, input.id));

        // Vollstorno-Prüfung: Gutschriftssummen >= Rechnungsbrutto → Rechnung storniert
        const alleGutschriften = await tx.query.creditNotes.findMany({
          where: eq(creditNotes.invoiceId, gutschrift.invoiceId),
        });
        const summeCent = alleGutschriften
          .filter((g) => g.id === input.id || g.status === "finalisiert")
          .reduce((a, g) => a + Math.round(Number(g.brutto) * 100), 0);
        const rechnungsBruttoCent = Math.round(Number(gutschrift.invoice.brutto) * 100);
        if (summeCent >= rechnungsBruttoCent && gutschrift.invoice.status !== "storniert") {
          await tx
            .update(invoices)
            .set({ status: "storniert" })
            .where(eq(invoices.id, gutschrift.invoiceId));
        }
        return nr;
      });

      return { nummer };
    }),

  delete: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const gutschrift = await db.query.creditNotes.findFirst({
        where: eq(creditNotes.id, input.id),
      });
      if (!gutschrift) throw new Error("Gutschrift nicht gefunden.");
      if (gutschrift.status !== "entwurf") {
        throw new Error("Finalisierte Gutschriften können nicht gelöscht werden (GoBD).");
      }
      await db.transaction(async (tx) => {
        await tx
          .delete(creditNoteItems)
          .where(eq(creditNoteItems.creditNoteId, input.id));
        await tx.delete(creditNotes).where(eq(creditNotes.id, input.id));
      });
      return { ok: true };
    }),
});
