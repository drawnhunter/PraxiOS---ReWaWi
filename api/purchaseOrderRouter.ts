import { z } from "zod";
import { authedQuery, createRouter } from "./middleware";
import { getDb } from "./queries/connection";
import {
  purchaseOrders,
  purchaseOrderItems,
  suppliers,
  companySettings,
} from "@db/schema";
import { eq, desc } from "drizzle-orm";
import { computeTotals, centToDecimal, nextNumber } from "./queries/invoicing";

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
  supplierId: z.number(),
  bestelldatum: dateString,
  lieferdatum: z.string().nullable().optional(),
  lieferantName: z.string().min(1),
  lieferantZusatz: z.string().nullable().optional(),
  lieferantStrasse: z.string().min(1),
  lieferantPlz: z.string().min(1),
  lieferantOrt: z.string().min(1),
  lieferantLand: z.string().default("Deutschland"),
  pdfNotiz: z.string().nullable().optional(),
  bemerkung: z.string().nullable().optional(),
});

function formatOrderNumber(jahr: number, n: number): string {
  return `B-${jahr}-${String(n).padStart(3, "0")}`;
}

async function ladeBestellungMitDetails(id: number) {
  const db = getDb();
  const bestellung = await db.query.purchaseOrders.findFirst({
    where: eq(purchaseOrders.id, id),
    with: { items: true, supplier: true },
  });
  if (bestellung?.items) {
    bestellung.items.sort((a, b) => a.position - b.position);
  }
  return bestellung;
}

export const purchaseOrderRouter = createRouter({
  list: authedQuery
    .input(
      z
        .object({
          status: z
            .enum(["entwurf", "bestellt", "teilgeliefert", "geliefert", "storniert"])
            .optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      return getDb().query.purchaseOrders.findMany({
        where: input?.status ? eq(purchaseOrders.status, input.status) : undefined,
        orderBy: [desc(purchaseOrders.createdAt)],
      });
    }),

  get: authedQuery
    .input(z.object({ id: z.number() }))
    .query(({ input }) => ladeBestellungMitDetails(input.id)),

  createDraft: authedQuery
    .input(z.object({ supplierId: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const lieferant = await db.query.suppliers.findFirst({
        where: eq(suppliers.id, input.supplierId),
      });
      if (!lieferant) throw new Error("Lieferant nicht gefunden.");

      const heute = new Date().toISOString().slice(0, 10);
      const [{ id }] = await db
        .insert(purchaseOrders)
        .values({
          supplierId: lieferant.id,
          bestelldatum: heute,
          lieferantName: lieferant.name,
          lieferantZusatz: lieferant.zusatz,
          lieferantStrasse: lieferant.strasse,
          lieferantPlz: lieferant.plz,
          lieferantOrt: lieferant.ort,
          lieferantLand: lieferant.land,
        })
        .$returningId();
      return { id };
    }),

  updateDraft: authedQuery
    .input(z.object({ id: z.number(), kopf: kopfInput, items: z.array(itemInput) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const bestellung = await db.query.purchaseOrders.findFirst({
        where: eq(purchaseOrders.id, input.id),
      });
      if (!bestellung) throw new Error("Bestellung nicht gefunden.");
      if (bestellung.status !== "entwurf") {
        throw new Error("Nur Entwürfe können bearbeitet werden.");
      }

      const totals = computeTotals(input.items);

      await db.transaction(async (tx) => {
        await tx
          .update(purchaseOrders)
          .set({
            ...input.kopf,
            lieferdatum: input.kopf.lieferdatum || null,
            pdfNotiz: input.kopf.pdfNotiz ?? null,
            netto: centToDecimal(totals.nettoCent),
            ust: centToDecimal(totals.ustCent),
            brutto: centToDecimal(totals.bruttoCent),
          })
          .where(eq(purchaseOrders.id, input.id));

        await tx
          .delete(purchaseOrderItems)
          .where(eq(purchaseOrderItems.purchaseOrderId, input.id));
        if (input.items.length > 0) {
          await tx.insert(purchaseOrderItems).values(
            input.items.map((it, i) => ({
              purchaseOrderId: input.id,
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

  /** Abschicken: Nummer vergeben, einfrieren. */
  bestellen: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const bestellung = await db.query.purchaseOrders.findFirst({
        where: eq(purchaseOrders.id, input.id),
        with: { items: true },
      });
      if (!bestellung) throw new Error("Bestellung nicht gefunden.");
      if (bestellung.status !== "entwurf") throw new Error("Bestellung wurde bereits abgeschickt.");
      if (bestellung.items.length === 0) {
        throw new Error("Eine Bestellung ohne Positionen kann nicht abgeschickt werden.");
      }

      const settings = await db.query.companySettings.findFirst({
        where: eq(companySettings.id, 1),
      });
      const firmenSnapshot = settings
        ? JSON.stringify({
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
          })
        : null;

      const jahr = Number(bestellung.bestelldatum.slice(0, 4));
      const nummer = await db.transaction(async (tx) => {
        const n = await nextNumber(tx, "purchase_order", jahr);
        const nr = formatOrderNumber(jahr, n);
        await tx
          .update(purchaseOrders)
          .set({
            nummer: nr,
            status: "bestellt",
            bestelltAt: new Date(),
            firmenSnapshot,
          })
          .where(eq(purchaseOrders.id, input.id));
        return nr;
      });
      return { nummer };
    }),

  /** Wareneingang buchen (teilweise oder komplett). */
  setLieferstatus: authedQuery
    .input(
      z.object({
        id: z.number(),
        status: z.enum(["teilgeliefert", "geliefert"]),
        datum: dateString.optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const bestellung = await db.query.purchaseOrders.findFirst({
        where: eq(purchaseOrders.id, input.id),
      });
      if (!bestellung) throw new Error("Bestellung nicht gefunden.");
      if (!["bestellt", "teilgeliefert"].includes(bestellung.status)) {
        throw new Error("Wareneingang nur für bestellte Bestellungen möglich.");
      }
      await db
        .update(purchaseOrders)
        .set({
          status: input.status,
          geliefertAm:
            input.status === "geliefert"
              ? (input.datum ?? new Date().toISOString().slice(0, 10))
              : null,
        })
        .where(eq(purchaseOrders.id, input.id));
      return { ok: true };
    }),

  stornieren: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const bestellung = await db.query.purchaseOrders.findFirst({
        where: eq(purchaseOrders.id, input.id),
      });
      if (!bestellung) throw new Error("Bestellung nicht gefunden.");
      if (bestellung.status === "geliefert") {
        throw new Error("Gelieferte Bestellungen können nicht storniert werden.");
      }
      await db
        .update(purchaseOrders)
        .set({ status: "storniert" })
        .where(eq(purchaseOrders.id, input.id));
      return { ok: true };
    }),

  delete: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const bestellung = await db.query.purchaseOrders.findFirst({
        where: eq(purchaseOrders.id, input.id),
      });
      if (!bestellung) throw new Error("Bestellung nicht gefunden.");
      if (bestellung.status !== "entwurf") {
        throw new Error("Nur Entwürfe können gelöscht werden — sonst bitte stornieren.");
      }
      await db.transaction(async (tx) => {
        await tx
          .delete(purchaseOrderItems)
          .where(eq(purchaseOrderItems.purchaseOrderId, input.id));
        await tx.delete(purchaseOrders).where(eq(purchaseOrders.id, input.id));
      });
      return { ok: true };
    }),
});
