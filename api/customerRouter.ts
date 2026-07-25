import { z } from "zod";
import { authedQuery, createRouter } from "./middleware";
import { getDb } from "./queries/connection";
import { customers } from "@db/schema";
import { eq, like, or, desc } from "drizzle-orm";

const customerInput = z.object({
  name: z.string().min(1),
  zusatz: z.string().nullable().optional(),
  strasse: z.string().min(1),
  plz: z.string().min(1),
  ort: z.string().min(1),
  land: z.string().default("Deutschland"),
  email: z.string().nullable().optional(),
  telefon: z.string().nullable().optional(),
  ustIdNr: z.string().nullable().optional(),
  zahlungszielTage: z.number().int().min(0).max(120).nullable().optional(),
  notizen: z.string().nullable().optional(),
});

export const customerRouter = createRouter({
  list: authedQuery
    .input(
      z
        .object({ suche: z.string().optional(), inklArchivierte: z.boolean().optional() })
        .optional(),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const suche = input?.suche?.trim();
      const inklArch = input?.inklArchivierte ?? false;
      const rows = await db.query.customers.findMany({
        where: suche
          ? or(
              like(customers.name, `%${suche}%`),
              like(customers.ort, `%${suche}%`),
              like(customers.email, `%${suche}%`),
            )
          : undefined,
        orderBy: [desc(customers.createdAt)],
      });
      return inklArch ? rows : rows.filter((r) => !r.archiviert);
    }),

  get: authedQuery.input(z.object({ id: z.number() })).query(async ({ input }) => {
    return getDb().query.customers.findFirst({ where: eq(customers.id, input.id) });
  }),

  create: authedQuery.input(customerInput).mutation(async ({ input }) => {
    const [{ id }] = await getDb().insert(customers).values(input).$returningId();
    return { id };
  }),

  update: authedQuery
    .input(z.object({ id: z.number(), data: customerInput }))
    .mutation(async ({ input }) => {
      await getDb()
        .update(customers)
        .set(input.data)
        .where(eq(customers.id, input.id));
      return { ok: true };
    }),

  setArchiviert: authedQuery
    .input(z.object({ id: z.number(), archiviert: z.boolean() }))
    .mutation(async ({ input }) => {
      await getDb()
        .update(customers)
        .set({ archiviert: input.archiviert })
        .where(eq(customers.id, input.id));
      return { ok: true };
    }),
});
