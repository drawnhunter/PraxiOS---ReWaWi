import { z } from "zod";
import { authedQuery, createRouter } from "./middleware";
import { getDb } from "./queries/connection";
import {
  deliveryNotes,
  deliveryNoteItems,
  customers,
  invoices,
  invoiceItems,
  companySettings,
  bankAccounts,
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

  /** NEM-Word-Import, Schritt 1: Datei zerlegen + Produkt-/Kunden-Vorschläge. */
  wordVorschau: authedQuery
    .input(z.object({ dateiBase64: z.string().min(50).max(20 * 1024 * 1024) }))
    .mutation(async ({ input }) => {
      const { parseNemDokument } = await import("./lib/nemWord");
      const { besterTreffer } = await import("@contracts/fuzzy");
      const db = getDb();

      const dok = parseNemDokument(Buffer.from(input.dateiBase64, "base64"));
      const [alleProdukte, alleKunden] = await Promise.all([
        db.query.products.findMany(),
        db.query.customers.findMany(),
      ]);
      const aktive = alleProdukte.filter((p) => p.aktiv);

      const positionen = dok.positionen.map((pos) => {
        const t = besterTreffer(aktive, pos.bezeichnung, (p) => p.name);
        return {
          ...pos,
          produktId: t?.treffer.id ?? null,
          produktName: t?.treffer.name ?? null,
          score: t?.score ?? 0,
        };
      });

      let kundeVorschlag: { id: number; name: string } | null = null;
      if (dok.name) {
        const kt = besterTreffer(alleKunden, dok.name, (k) => k.name, 60);
        if (kt) kundeVorschlag = { id: kt.treffer.id, name: kt.treffer.name };
      }

      return {
        name: dok.name,
        geburtsdatum: dok.geburtsdatum,
        datum: dok.datum,
        phase: dok.phase,
        format: dok.format,
        positionen,
        kundeVorschlag,
      };
    }),

  /** NEM-Word-Import, Schritt 2: Lieferschein-Entwurf anlegen. */
  wordAnlegen: authedQuery
    .input(
      z.object({
        customerId: z.number(),
        datum: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        phase: z.string().max(100).optional(),
        dokName: z.string().max(255).optional(),
        dateiname: z.string().max(255).default("dokument.docx"),
        items: z
          .array(
            z.object({
              bezeichnung: z.string().min(1).max(255),
              menge: z.string().min(1),
              einheit: z.string().min(1).max(30),
            }),
          )
          .min(1),
      }),
    )
    .mutation(async ({ input }) => {
      const { legeLieferscheinAusNemAn } = await import("./lib/nemWord");
      return legeLieferscheinAusNemAn(
        input.customerId,
        {
          name: input.dokName ?? null, geburtsdatum: null, datum: null, phase: input.phase ?? null,
          positionen: input.items.map((it) => ({
            bezeichnung: it.bezeichnung,
            menge: Number(it.menge),
            einzelpreis: null,
          })),
          format: "tabelle",
        },
        input.dateiname,
      );
    }),

  /** Rechnung aus einem finalisierten Lieferschein (Positionen bekommen
      Preise aus dem Produktstamm, Kundenkonditionen zuerst). */
  createInvoice: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { besterTreffer } = await import("@contracts/fuzzy");
      const ls = await db.query.deliveryNotes.findFirst({
        where: eq(deliveryNotes.id, input.id),
        with: { items: true, customer: true },
      });
      if (!ls) throw new Error("Lieferschein nicht gefunden.");
      if (ls.status !== "finalisiert") {
        throw new Error("Erst finalisieren, dann die Rechnung erstellen (Lieferung vor Rechnung).");
      }
      if (ls.invoiceId) throw new Error("Zu diesem Lieferschein existiert bereits eine Rechnung.");

      const alleProdukte = (await db.query.products.findMany()).filter((p) => p.aktiv);
      const konditionenRows = await db.query.konditionen.findMany({
        where: (k, { and: a, eq: e }) =>
          a(e(k.typ, "kunde"), e(k.partnerId, ls.customerId)),
      });

      const settings = await db.query.companySettings.findFirst({
        where: eq(companySettings.id, 1),
      });
      const zielTage = ls.customer?.zahlungszielTage ?? settings?.standardZahlungsziel ?? 14;
      const heute = new Date();
      const faellig = new Date(heute);
      faellig.setDate(faellig.getDate() + zielTage);
      const fmt = (d: Date) => d.toISOString().slice(0, 10);
      const standardBank = await db.query.bankAccounts.findFirst({
        where: eq(bankAccounts.istStandard, true),
      });

      const [{ id: rechnungId }] = await db
        .insert(invoices)
        .values({
          customerId: ls.customerId,
          rechnungsdatum: fmt(heute),
          faelligkeitsdatum: fmt(faellig),
          bankAccountId: standardBank?.id ?? null,
          kundeName: ls.kundeName,
          kundeZusatz: ls.kundeZusatz,
          kundeStrasse: ls.kundeStrasse,
          kundePlz: ls.kundePlz,
          kundeOrt: ls.kundeOrt,
          kundeLand: ls.kundeLand,
          pdfNotiz: `Lieferung laut Lieferschein ${ls.nummer ?? `#${ls.id}`} vom ${ls.datum}`,
        })
        .$returningId();

      const { computeTotals, centToDecimal } = await import("./queries/invoicing");
      const zeilen = ls.items.map((it) => {
        const t = besterTreffer(alleProdukte, it.bezeichnung, (p) => p.name);
        const kondition = t
          ? konditionenRows.find((k) => k.productId === t.treffer.id)
          : undefined;
        const preis = kondition?.preisNetto ?? t?.treffer.preisNetto ?? "0.00";
        return {
          invoiceId: rechnungId,
          position: it.position,
          bezeichnung: it.bezeichnung,
          beschreibung: it.beschreibung,
          menge: it.menge,
          einheit: it.einheit,
          einzelpreis: preis,
          ustSatz: t?.treffer.ustSatz ?? 19,
        };
      });
      if (zeilen.length > 0) await db.insert(invoiceItems).values(zeilen);

      const totals = computeTotals(
        zeilen.map((z) => ({ menge: z.menge, einzelpreis: z.einzelpreis, ustSatz: z.ustSatz })),
      );
      await db
        .update(invoices)
        .set({
          netto: centToDecimal(totals.nettoCent),
          ust: centToDecimal(totals.ustCent),
          brutto: centToDecimal(totals.bruttoCent),
        })
        .where(eq(invoices.id, rechnungId));

      await db
        .update(deliveryNotes)
        .set({ invoiceId: rechnungId })
        .where(eq(deliveryNotes.id, ls.id));

      return { id: rechnungId, positionenOhneTreffer: zeilen.filter((z) => Number(z.einzelpreis) === 0).length };
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
