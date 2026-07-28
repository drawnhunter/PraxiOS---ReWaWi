import { z } from "zod";
import { authedQuery, createRouter } from "./middleware";
import { getDb } from "./queries/connection";
import {
  invoices,
  invoiceItems,
  creditNotes,
  creditNoteItems,
  customers,
  companySettings,
  bankAccounts,
} from "@db/schema";
import { eq, desc } from "drizzle-orm";
import {
  computeTotals,
  centToDecimal,
  nextNumber,
  formatInvoiceNumber,
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
  rechnungsdatum: dateString,
  faelligkeitsdatum: dateString,
  leistungsdatum: z.string().nullable().optional(),
  bankAccountId: z.number().nullable().optional(),
  kundeName: z.string().min(1),
  kundeZusatz: z.string().nullable().optional(),
  kundeStrasse: z.string().min(1),
  kundePlz: z.string().min(1),
  kundeOrt: z.string().min(1),
  kundeLand: z.string().default("Deutschland"),
  pdfNotiz: z.string().nullable().optional(),
  bereitsBezahlt: z.boolean().optional(),
  bemerkung: z.string().nullable().optional(),
});

async function ladeRechnungMitDetails(id: number) {
  const db = getDb();
  const rechnung = await db.query.invoices.findFirst({
    where: eq(invoices.id, id),
    with: {
      items: true,
      customer: true,
      bankAccount: true,
      creditNotes: { with: { items: true } },
    },
  });
  if (rechnung?.items) {
    rechnung.items.sort((a, b) => a.position - b.position);
  }
  return rechnung;
}

export const invoiceRouter = createRouter({
  list: authedQuery
    .input(
      z
        .object({ status: z.enum(["entwurf", "finalisiert", "storniert"]).optional() })
        .optional(),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const rows = await db.query.invoices.findMany({
        where: input?.status ? eq(invoices.status, input.status) : undefined,
        orderBy: [desc(invoices.createdAt)],
        with: { creditNotes: true },
      });
      return rows;
    }),

  get: authedQuery
    .input(z.object({ id: z.number() }))
    .query(({ input }) => ladeRechnungMitDetails(input.id)),

  /** Neuen Entwurf anlegen — Kundenadresse wird als Snapshot kopiert. */
  createDraft: authedQuery
    .input(z.object({ customerId: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const kunde = await db.query.customers.findFirst({
        where: eq(customers.id, input.customerId),
      });
      if (!kunde) throw new Error("Kunde nicht gefunden.");

      const settings = await db.query.companySettings.findFirst({
        where: eq(companySettings.id, 1),
      });
      // Kundenspezifisches Zahlungsziel hat Vorrang vor dem Standard
      const zielTage =
        kunde.zahlungszielTage ?? settings?.standardZahlungsziel ?? 14;

      const heute = new Date();
      const faellig = new Date(heute);
      faellig.setDate(faellig.getDate() + zielTage);
      const fmt = (d: Date) => d.toISOString().slice(0, 10);

      const standardBank = await db.query.bankAccounts.findFirst({
        where: eq(bankAccounts.istStandard, true),
      });

      const [{ id }] = await db
        .insert(invoices)
        .values({
          customerId: kunde.id,
          rechnungsdatum: fmt(heute),
          faelligkeitsdatum: fmt(faellig),
          bankAccountId: standardBank?.id ?? null,
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

  /** Entwurf speichern (Kopf + Positionen). Nicht-finalisierte Belege only. */
  updateDraft: authedQuery
    .input(z.object({ id: z.number(), kopf: kopfInput, items: z.array(itemInput) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const rechnung = await db.query.invoices.findFirst({
        where: eq(invoices.id, input.id),
      });
      if (!rechnung) throw new Error("Rechnung nicht gefunden.");
      if (rechnung.status !== "entwurf") {
        throw new Error("Nur Entwürfe können bearbeitet werden (GoBD).");
      }

      const totals = computeTotals(input.items);

      await db.transaction(async (tx) => {
        await tx
          .update(invoices)
          .set({
            ...input.kopf,
            leistungsdatum: input.kopf.leistungsdatum ?? null,
            bankAccountId: input.kopf.bankAccountId ?? null,
            pdfNotiz: input.kopf.pdfNotiz ?? null,
            bereitsBezahlt: input.kopf.bereitsBezahlt ?? false,
            netto: centToDecimal(totals.nettoCent),
            ust: centToDecimal(totals.ustCent),
            brutto: centToDecimal(totals.bruttoCent),
          })
          .where(eq(invoices.id, input.id));

        await tx.delete(invoiceItems).where(eq(invoiceItems.invoiceId, input.id));
        if (input.items.length > 0) {
          await tx.insert(invoiceItems).values(
            input.items.map((it, i) => ({
              invoiceId: input.id,
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

  /** Finalisieren: Nummer vergeben, Snapshots einfrieren. Danach unveränderbar. */
  finalize: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const rechnung = await db.query.invoices.findFirst({
        where: eq(invoices.id, input.id),
        with: { items: true },
      });
      if (!rechnung) throw new Error("Rechnung nicht gefunden.");
      if (rechnung.status !== "entwurf") throw new Error("Rechnung ist bereits finalisiert.");
      if (rechnung.items.length === 0) {
        throw new Error("Eine Rechnung ohne Positionen kann nicht finalisiert werden.");
      }

      const settings = await db.query.companySettings.findFirst({
        where: eq(companySettings.id, 1),
      });
      if (!settings) throw new Error("Firmen-Einstellungen fehlen.");

      let bank: typeof bankAccounts.$inferSelect | undefined;
      if (rechnung.bankAccountId) {
        bank = await db.query.bankAccounts.findFirst({
          where: eq(bankAccounts.id, rechnung.bankAccountId),
        });
      }

      const jahr = Number(rechnung.rechnungsdatum.slice(0, 4));
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
      const bankSnapshot = bank
        ? JSON.stringify({
            bezeichnung: bank.bezeichnung,
            bankName: bank.bankName,
            kontoinhaber: bank.kontoinhaber,
            iban: bank.iban,
            bic: bank.bic,
          })
        : null;

      const nummer = await db.transaction(async (tx) => {
        const n = await nextNumber(tx, "invoice", jahr);
        const nr = formatInvoiceNumber(jahr, n);
        // Zahlungsziel „bereits bezahlt“ → direkt als bezahlt verbuchen
        const bezahltSet = rechnung.bereitsBezahlt
          ? {
              bezahltBetrag: rechnung.brutto,
              bezahltAm: rechnung.rechnungsdatum,
            }
          : {};
        await tx
          .update(invoices)
          .set({
            nummer: nr,
            status: "finalisiert",
            finalizedAt: new Date(),
            firmenSnapshot,
            bankSnapshot,
            ...bezahltSet,
          })
          .where(eq(invoices.id, input.id));
        return nr;
      });

      return { nummer };
    }),

  /** Zahlungseingang verbuchen. */
  markPaid: authedQuery
    .input(
      z.object({
        id: z.number(),
        betrag: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
        datum: dateString.optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const rechnung = await db.query.invoices.findFirst({
        where: eq(invoices.id, input.id),
      });
      if (!rechnung) throw new Error("Rechnung nicht gefunden.");
      if (rechnung.status === "entwurf") {
        throw new Error("Entwurf muss zuerst finalisiert werden.");
      }
      await db
        .update(invoices)
        .set({
          bezahltBetrag: input.betrag ?? rechnung.brutto,
          bezahltAm: input.datum ?? new Date().toISOString().slice(0, 10),
        })
        .where(eq(invoices.id, input.id));
      return { ok: true };
    }),

  /** Zahlung zurücksetzen (Korrektur, z.B. falscher Betrag eingetragen). */
  unmarkPaid: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await getDb()
        .update(invoices)
        .set({ bezahltBetrag: "0", bezahltAm: null })
        .where(eq(invoices.id, input.id));
      return { ok: true };
    }),

  /** Löschen nur im Entwurfsstadium — danach greift GoBD. */
  delete: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const rechnung = await db.query.invoices.findFirst({
        where: eq(invoices.id, input.id),
      });
      if (!rechnung) throw new Error("Rechnung nicht gefunden.");
      if (rechnung.status !== "entwurf") {
        throw new Error(
          "Finalisierte Rechnungen können nicht gelöscht werden (GoBD) — bitte stornieren.",
        );
      }
      await db.transaction(async (tx) => {
        await tx.delete(invoiceItems).where(eq(invoiceItems.invoiceId, input.id));
        await tx.delete(invoices).where(eq(invoices.id, input.id));
      });
      return { ok: true };
    }),

  /** Gutschrift (Storno) aus einer finalisierten Rechnung erzeugen. */
  createCreditNote: authedQuery
    .input(z.object({ invoiceId: z.number(), grund: z.string().optional() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const rechnung = await db.query.invoices.findFirst({
        where: eq(invoices.id, input.invoiceId),
        with: { items: true },
      });
      if (!rechnung) throw new Error("Rechnung nicht gefunden.");
      if (rechnung.status === "entwurf") {
        throw new Error("Nur finalisierte Rechnungen können storniert werden.");
      }

      const heute = new Date().toISOString().slice(0, 10);
      const [{ id }] = await db
        .insert(creditNotes)
        .values({
          invoiceId: rechnung.id,
          datum: heute,
          grund: input.grund ?? null,
          bankAccountId: rechnung.bankAccountId,
          kundeName: rechnung.kundeName,
          kundeZusatz: rechnung.kundeZusatz,
          kundeStrasse: rechnung.kundeStrasse,
          kundePlz: rechnung.kundePlz,
          kundeOrt: rechnung.kundeOrt,
          kundeLand: rechnung.kundeLand,
          netto: rechnung.netto,
          ust: rechnung.ust,
          brutto: rechnung.brutto,
        })
        .$returningId();

      if (rechnung.items.length > 0) {
        await db.insert(creditNoteItems).values(
          rechnung.items.map((it) => ({
            creditNoteId: id,
            position: it.position,
            bezeichnung: it.bezeichnung,
            beschreibung: it.beschreibung,
            menge: it.menge,
            einheit: it.einheit,
            einzelpreis: it.einzelpreis,
            ustSatz: it.ustSatz,
          })),
        );
      }
      return { id };
    }),
});
