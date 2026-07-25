import { z } from "zod";
import { authedQuery, createRouter } from "./middleware";
import { getDb } from "./queries/connection";
import { suppliers } from "@db/schema";
import { eq, like, or, desc } from "drizzle-orm";

const supplierInput = z.object({
  name: z.string().min(1),
  zusatz: z.string().nullable().optional(),
  strasse: z.string().min(1),
  plz: z.string().min(1),
  ort: z.string().min(1),
  land: z.string().default("Deutschland"),
  email: z.string().nullable().optional(),
  telefon: z.string().nullable().optional(),
  ustIdNr: z.string().nullable().optional(),
  notizen: z.string().nullable().optional(),
});

export const supplierRouter = createRouter({
  list: authedQuery
    .input(
      z
        .object({ suche: z.string().optional(), inklArchivierte: z.boolean().optional() })
        .optional(),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const suche = input?.suche?.trim();
      const rows = await db.query.suppliers.findMany({
        where: suche
          ? or(
              like(suppliers.name, `%${suche}%`),
              like(suppliers.ort, `%${suche}%`),
              like(suppliers.email, `%${suche}%`),
            )
          : undefined,
        orderBy: [desc(suppliers.createdAt)],
      });
      return input?.inklArchivierte ? rows : rows.filter((r) => !r.archiviert);
    }),

  get: authedQuery.input(z.object({ id: z.number() })).query(async ({ input }) => {
    return getDb().query.suppliers.findFirst({ where: eq(suppliers.id, input.id) });
  }),

  create: authedQuery.input(supplierInput).mutation(async ({ input }) => {
    const [{ id }] = await getDb().insert(suppliers).values(input).$returningId();
    return { id };
  }),

  update: authedQuery
    .input(z.object({ id: z.number(), data: supplierInput }))
    .mutation(async ({ input }) => {
      await getDb()
        .update(suppliers)
        .set(input.data)
        .where(eq(suppliers.id, input.id));
      return { ok: true };
    }),

  setArchiviert: authedQuery
    .input(z.object({ id: z.number(), archiviert: z.boolean() }))
    .mutation(async ({ input }) => {
      await getDb()
        .update(suppliers)
        .set({ archiviert: input.archiviert })
        .where(eq(suppliers.id, input.id));
      return { ok: true };
    }),
});
