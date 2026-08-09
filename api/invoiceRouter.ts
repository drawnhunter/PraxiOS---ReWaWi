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
  mailLog,
  bankTransaktionen,
} from "@db/schema";
import { and, eq, desc } from "drizzle-orm";
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
        .object({
          status: z.enum(["entwurf", "finalisiert", "storniert"]).optional(),
          archiviert: z.boolean().optional(), // Standard: nur nicht-archivierte
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const bed = [
        ...(input?.status ? [eq(invoices.status, input.status)] : []),
        eq(invoices.archiviert, input?.archiviert ?? false),
      ];
      const rows = await db.query.invoices.findMany({
        where: and(...bed),
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
        // Zahlungsziel „bereits bezahlt“ → direkt als bezahlt verbuchen
        const bezahltSet = rechnung.bereitsBezahlt
          ? {
              bezahltBetrag: rechnung.brutto,
              bezahltAm: rechnung.rechnungsdatum,
            }
          : {};
        // v1.2.2 — Kollisionsschutz: Der Altbestand-Import kann Nummern im
        // eigenen Kreis-Format belegt haben (auch historisch, vor dem Fix).
        // Daher hochzaehlen, bis eine freie Nummer gefunden ist, statt mit
        // ER_DUP_ENTRY zu scheitern und den Zaehler per Rollback einzufrieren.
        // GoBD: Jede vergebene Nummer existiert genau einmal; uebersprungene
        // Nummern sind durch importierte Original-Belege belegt.
        for (let versuch = 0; versuch < 1000; versuch++) {
          const n = await nextNumber(tx, "invoice", jahr);
          const nr = formatInvoiceNumber(jahr, n);
          const [kollision] = await tx
            .select({ id: invoices.id })
            .from(invoices)
            .where(eq(invoices.nummer, nr))
            .limit(1);
          if (kollision) {
            console.warn(`[finalize] Nummer ${nr} bereits vergeben — ueberspringe`);
            continue;
          }
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
        }
        throw new Error(
          "Keine freie Rechnungsnummer gefunden (1000 Kollisionen) — Nummernkreis bitte prüfen.",
        );
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

  /** v1.6: Beleg duplizieren — Kopf + Positionen in einen neuen Entwurf. */
  duplicate: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const r = await db.query.invoices.findFirst({
        where: eq(invoices.id, input.id),
        with: { items: true },
      });
      if (!r) throw new Error("Rechnung nicht gefunden.");
      const heute = new Date().toISOString().slice(0, 10);
      const [{ id }] = await db
        .insert(invoices)
        .values({
          customerId: r.customerId,
          rechnungsdatum: heute,
          faelligkeitsdatum: r.faelligkeitsdatum,
          leistungsdatum: r.leistungsdatum,
          bankAccountId: r.bankAccountId,
          kundeName: r.kundeName,
          kundeZusatz: r.kundeZusatz,
          kundeStrasse: r.kundeStrasse,
          kundePlz: r.kundePlz,
          kundeOrt: r.kundeOrt,
          kundeLand: r.kundeLand,
          netto: r.netto,
          ust: r.ust,
          brutto: r.brutto,
          bereitsBezahlt: false,
          pdfNotiz: r.pdfNotiz,
          bemerkung: r.bemerkung,
        })
        .$returningId();
      if (r.items.length > 0) {
        await db.insert(invoiceItems).values(
          r.items.map((it) => ({
            invoiceId: id,
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

  /** v1.6: Archivieren/Entarchivieren — GoBD-sicher (Beleg bleibt erhalten). */
  setArchiviert: authedQuery
    .input(z.object({ id: z.number(), archiviert: z.boolean() }))
    .mutation(async ({ input }) => {
      await getDb()
        .update(invoices)
        .set({ archiviert: input.archiviert })
        .where(eq(invoices.id, input.id));
      return { ok: true };
    }),

  /** v1.6: Aktivitaets-Timeline einer Rechnung (fuer das Seitenpanel). */
  aktivitaeten: authedQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const r = await db.query.invoices.findFirst({
        where: eq(invoices.id, input.id),
        with: { creditNotes: true },
      });
      if (!r) throw new Error("Rechnung nicht gefunden.");
      const mails = await db
        .select()
        .from(mailLog)
        .where(and(eq(mailLog.belegArt, "rechnung"), eq(mailLog.belegId, input.id)))
        .orderBy(desc(mailLog.gesendetAm));
      const bank = await db
        .select({
          datum: bankTransaktionen.datum,
          betrag: bankTransaktionen.zugeordneterBetrag,
          zugeordnetAm: bankTransaktionen.zugeordnetAm,
        })
        .from(bankTransaktionen)
        .where(and(eq(bankTransaktionen.invoiceId, input.id), eq(bankTransaktionen.status, "zugeordnet")))
        .orderBy(desc(bankTransaktionen.datum));
      return {
        erstelltAm: r.createdAt,
        finalizedAm: r.finalizedAt,
        bezahltAm: r.bezahltAm,
        bezahltBetrag: r.bezahltBetrag,
        mails,
        bankZuordnungen: bank,
        gutschriften: r.creditNotes.map((g) => ({ id: g.id, nummer: g.nummer, datum: g.datum, brutto: g.brutto })),
      };
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
