import { z } from "zod";
import { authedQuery, createRouter } from "./middleware";
import { getDb } from "./queries/connection";
import {
  deliveryNotes,
  deliveryNoteItems,
  customers,
  invoices,
  companySettings,
} from "@db/schema";
import { eq, desc } from "drizzle-orm";
import { nextNumber } from "./queries/invoicing";

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format: JJJJ-MM-TT");

const itemInput = z.object({
  bezeichnung: z.string().min(1),
  beschreibung: z.string().nullable().optional(),
  menge: z.string().regex(/^\d+(\.\d{1,3})?$/, "Menge mit max. 3 Dezimalstellen"),
  einheit: z.string().min(1).default("Stück"),
});

const kopfInput = z.object({
  datum: dateString,
  invoiceId: z.number().nullable().optional(),
  kundeName: z.string().min(1),
  kundeZusatz: z.string().nullable().optional(),
  kundeStrasse: z.string().min(1),
  kundePlz: z.string().min(1),
  kundeOrt: z.string().min(1),
  kundeLand: z.string().default("Deutschland"),
  pdfNotiz: z.string().nullable().optional(),
  bemerkung: z.string().nullable().optional(),
});

function formatDeliveryNumber(jahr: number, n: number): string {
  return `LS-${jahr}-${String(n).padStart(3, "0")}`;
}

async function firmenSnapshotJson(): Promise<string | null> {
  const settings = await getDb().query.companySettings.findFirst({
    where: eq(companySettings.id, 1),
  });
  if (!settings) return null;
  return JSON.stringify({
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
  });
}

async function ladeLieferscheinMitDetails(id: number) {
  const db = getDb();
  const ls = await db.query.deliveryNotes.findFirst({
    where: eq(deliveryNotes.id, id),
    with: { items: true, invoice: true, customer: true },
  });
  if (ls?.items) ls.items.sort((a, b) => a.position - b.position);
  return ls;
}

export const deliveryNoteRouter = createRouter({
  list: authedQuery.query(async () => {
    return getDb().query.deliveryNotes.findMany({
      orderBy: [desc(deliveryNotes.createdAt)],
      with: { invoice: true },
    });
  }),

  get: authedQuery
    .input(z.object({ id: z.number() }))
    .query(({ input }) => ladeLieferscheinMitDetails(input.id)),

  /** Blanko-Lieferschein für einen Kunden. */
  createDraft: authedQuery
    .input(z.object({ customerId: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const kunde = await db.query.customers.findFirst({
        where: eq(customers.id, input.customerId),
      });
      if (!kunde) throw new Error("Kunde nicht gefunden.");
      const [{ id }] = await db
        .insert(deliveryNotes)
        .values({
          customerId: kunde.id,
          datum: new Date().toISOString().slice(0, 10),
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

  /** Lieferschein aus einer Rechnung (Positionen ohne Preise). */
  createFromInvoice: authedQuery
    .input(z.object({ invoiceId: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const rechnung = await db.query.invoices.findFirst({
        where: eq(invoices.id, input.invoiceId),
        with: { items: true },
      });
      if (!rechnung) throw new Error("Rechnung nicht gefunden.");
      if (rechnung.status === "entwurf") {
        throw new Error("Lieferscheine nur zu finalisierten Rechnungen.");
      }

      const [{ id }] = await db
        .insert(deliveryNotes)
        .values({
          customerId: rechnung.customerId,
          invoiceId: rechnung.id,
          datum: new Date().toISOString().slice(0, 10),
          kundeName: rechnung.kundeName,
          kundeZusatz: rechnung.kundeZusatz,
          kundeStrasse: rechnung.kundeStrasse,
          kundePlz: rechnung.kundePlz,
          kundeOrt: rechnung.kundeOrt,
          kundeLand: rechnung.kundeLand,
        })
        .$returningId();

      if (rechnung.items.length > 0) {
        await db.insert(deliveryNoteItems).values(
          rechnung.items.map((it) => ({
            deliveryNoteId: id,
            position: it.position,
            bezeichnung: it.bezeichnung,
            beschreibung: it.beschreibung,
            menge: it.menge,
            einheit: it.einheit,
          })),
        );
      }
      return { id };
    }),

  updateDraft: authedQuery
    .input(z.object({ id: z.number(), kopf: kopfInput, items: z.array(itemInput) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const ls = await db.query.deliveryNotes.findFirst({
        where: eq(deliveryNotes.id, input.id),
      });
      if (!ls) throw new Error("Lieferschein nicht gefunden.");
      if (ls.status !== "entwurf") {
        throw new Error("Nur Entwürfe können bearbeitet werden.");
      }

      await db.transaction(async (tx) => {
        await tx
          .update(deliveryNotes)
          .set({
            ...input.kopf,
            invoiceId: input.kopf.invoiceId ?? null,
            pdfNotiz: input.kopf.pdfNotiz ?? null,
          })
          .where(eq(deliveryNotes.id, input.id));

        await tx
          .delete(deliveryNoteItems)
          .where(eq(deliveryNoteItems.deliveryNoteId, input.id));
        if (input.items.length > 0) {
          await tx.insert(deliveryNoteItems).values(
            input.items.map((it, i) => ({
              deliveryNoteId: input.id,
              position: i + 1,
              bezeichnung: it.bezeichnung,
              beschreibung: it.beschreibung ?? null,
              menge: it.menge,
              einheit: it.einheit,
            })),
          );
        }
      });
      return { ok: true };
    }),

  finalize: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const ls = await db.query.deliveryNotes.findFirst({
        where: eq(deliveryNotes.id, input.id),
        with: { items: true },
      });
      if (!ls) throw new Error("Lieferschein nicht gefunden.");
      if (ls.status !== "entwurf") throw new Error("Lieferschein ist bereits finalisiert.");
      if (ls.items.length === 0) {
        throw new Error("Ein Lieferschein ohne Positionen kann nicht finalisiert werden.");
      }

      const snapshot = await firmenSnapshotJson();
      const jahr = Number(ls.datum.slice(0, 4));
      const nummer = await db.transaction(async (tx) => {
        const n = await nextNumber(tx, "delivery_note", jahr);
        const nr = formatDeliveryNumber(jahr, n);
        await tx
          .update(deliveryNotes)
          .set({
            nummer: nr,
            status: "finalisiert",
            finalizedAt: new Date(),
            firmenSnapshot: snapshot,
          })
          .where(eq(deliveryNotes.id, input.id));
        return nr;
      });
      return { nummer };
    }),

  /** Finalisierte Lieferscheine können storniert (ungültig markiert) werden. */
  stornieren: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const ls = await db.query.deliveryNotes.findFirst({
        where: eq(deliveryNotes.id, input.id),
      });
      if (!ls) throw new Error("Lieferschein nicht gefunden.");
      if (ls.status !== "finalisiert") {
        throw new Error("Nur finalisierte Lieferscheine müssen storniert werden — Entwürfe einfach löschen.");
      }
      await db
        .update(deliveryNotes)
        .set({ status: "storniert" })
        .where(eq(deliveryNotes.id, input.id));
      return { ok: true };
    }),

  delete: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const ls = await db.query.deliveryNotes.findFirst({
        where: eq(deliveryNotes.id, input.id),
      });
      if (!ls) throw new Error("Lieferschein nicht gefunden.");
      if (ls.status !== "entwurf") {
        throw new Error("Nur Entwürfe können gelöscht werden — sonst bitte stornieren.");
      }
      await db.transaction(async (tx) => {
        await tx
          .delete(deliveryNoteItems)
          .where(eq(deliveryNoteItems.deliveryNoteId, input.id));
        await tx.delete(deliveryNotes).where(eq(deliveryNotes.id, input.id));
      });
      return { ok: true };
    }),
});
