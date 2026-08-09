import { z } from "zod";
import { authedQuery, createRouter } from "./middleware";
import { getDb } from "./queries/connection";
import { products, konditionen } from "@db/schema";
import { eq, like, or, desc, and } from "drizzle-orm";

const productInput = z.object({
  name: z.string().min(1),
  artikelnummer: z.string().nullable().optional(),
  beschreibung: z.string().nullable().optional(),
  einheit: z.string().min(1).default("Stück"),
  preisNetto: z.string().regex(/^\d+(\.\d{1,2})?$/, "Preis mit max. 2 Dezimalstellen"),
  ekPreisNetto: z.string().regex(/^\d+(\.\d{1,2})?$/, "Preis mit max. 2 Dezimalstellen").nullable().optional(),
  kategorie: z.string().nullable().optional(),
  barcode: z.string().nullable().optional(),
  mindestbestand: z.string().regex(/^\d+(\.\d{1,2})?$/).nullable().optional(),
  lagerAktiv: z.boolean().default(false),
  ustSatz: z.number().int().refine((v) => [19, 7, 0].includes(v), "Nur 19 %, 7 % oder 0 %"),
});

export const productRouter = createRouter({
  list: authedQuery
    .input(z.object({ suche: z.string().optional(), inklInaktive: z.boolean().optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const suche = input?.suche?.trim();
      const rows = await db.query.products.findMany({
        where: suche
          ? or(like(products.name, `%${suche}%`), like(products.beschreibung, `%${suche}%`))
          : undefined,
        orderBy: [desc(products.createdAt)],
      });
      return input?.inklInaktive ? rows : rows.filter((r) => r.aktiv);
    }),

  get: authedQuery.input(z.object({ id: z.number() })).query(async ({ input }) => {
    return getDb().query.products.findFirst({ where: eq(products.id, input.id) });
  }),

  create: authedQuery.input(productInput).mutation(async ({ input }) => {
    const [{ id }] = await getDb().insert(products).values(input).$returningId();
    return { id };
  }),

  update: authedQuery
    .input(z.object({ id: z.number(), data: productInput }))
    .mutation(async ({ input }) => {
      await getDb()
        .update(products)
        .set(input.data)
        .where(eq(products.id, input.id));
      return { ok: true };
    }),

  setAktiv: authedQuery
    .input(z.object({ id: z.number(), aktiv: z.boolean() }))
    .mutation(async ({ input }) => {
      await getDb()
        .update(products)
        .set({ aktiv: input.aktiv })
        .where(eq(products.id, input.id));
      return { ok: true };
    }),

  // ── Konditionen (Sonderpreise je Kunde/Lieferant + Produkt) ─────────────
  konditionenListe: authedQuery
    .input(z.object({ typ: z.enum(["kunde", "lieferant"]), partnerId: z.number() }))
    .query(async ({ input }) => {
      const rows = await getDb()
        .select({
          id: konditionen.id,
          productId: konditionen.productId,
          preisNetto: konditionen.preisNetto,
          produktName: products.name,
          einheit: products.einheit,
        })
        .from(konditionen)
        .innerJoin(products, eq(konditionen.productId, products.id))
        .where(and(eq(konditionen.typ, input.typ), eq(konditionen.partnerId, input.partnerId)));
      return rows;
    }),

  konditionSetzen: authedQuery
    .input(
      z.object({
        typ: z.enum(["kunde", "lieferant"]),
        partnerId: z.number(),
        productId: z.number(),
        preisNetto: z.string().regex(/^\d+(\.\d{1,2})?$/, "Preis mit max. 2 Dezimalstellen"),
      }),
    )
    .mutation(async ({ input }) => {
      await getDb()
        .insert(konditionen)
        .values(input)
        .onDuplicateKeyUpdate({ set: { preisNetto: input.preisNetto } });
      return { ok: true };
    }),

  konditionLoeschen: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await getDb().delete(konditionen).where(eq(konditionen.id, input.id));
      return { ok: true };
    }),

  // Preisermittlung fuer Belege: Sonderpreis vor Standard
  // (Kunde -> VK, Lieferant -> EK mit VK-Fallback)
  preisFuer: authedQuery
    .input(
      z.object({
        typ: z.enum(["kunde", "lieferant"]),
        partnerId: z.number(),
        productId: z.number(),
      }),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const rows = await db
        .select()
        .from(konditionen)
        .where(
          and(
            eq(konditionen.typ, input.typ),
            eq(konditionen.partnerId, input.partnerId),
            eq(konditionen.productId, input.productId),
          ),
        )
        .limit(1);
      if (rows.length > 0) {
        return { preisNetto: rows[0].preisNetto, quelle: "kondition" as const };
      }
      const p = await db.query.products.findFirst({ where: eq(products.id, input.productId) });
      if (!p) throw new Error("Produkt nicht gefunden.");
      const preis =
        input.typ === "lieferant" && p.ekPreisNetto ? p.ekPreisNetto : p.preisNetto;
      return { preisNetto: preis, quelle: "standard" as const };
    }),
});
