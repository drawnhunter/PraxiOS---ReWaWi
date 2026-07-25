import { z } from "zod";
import { authedQuery, createRouter } from "./middleware";
import { getDb } from "./queries/connection";
import { bankAccounts, invoices } from "@db/schema";
import { eq, desc } from "drizzle-orm";

const bankInput = z.object({
  bezeichnung: z.string().min(1),
  bankName: z.string().min(1),
  kontoinhaber: z.string().min(1),
  iban: z.string().min(8),
  bic: z.string().nullable().optional(),
});

export const bankRouter = createRouter({
  list: authedQuery.query(async () => {
    return getDb()
      .select()
      .from(bankAccounts)
      .orderBy(desc(bankAccounts.istStandard), bankAccounts.bezeichnung);
  }),

  create: authedQuery.input(bankInput).mutation(async ({ input }) => {
    const [{ id }] = await getDb().insert(bankAccounts).values(input).$returningId();
    return { id };
  }),

  update: authedQuery
    .input(z.object({ id: z.number(), data: bankInput }))
    .mutation(async ({ input }) => {
      await getDb()
        .update(bankAccounts)
        .set(input.data)
        .where(eq(bankAccounts.id, input.id));
      return { ok: true };
    }),

  setStandard: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.update(bankAccounts).set({ istStandard: false });
      await db
        .update(bankAccounts)
        .set({ istStandard: true })
        .where(eq(bankAccounts.id, input.id));
      return { ok: true };
    }),

  /** Deaktivieren statt löschen — historische Belege referenzieren das Konto. */
  setAktiv: authedQuery
    .input(z.object({ id: z.number(), aktiv: z.boolean() }))
    .mutation(async ({ input }) => {
      await getDb()
        .update(bankAccounts)
        .set({ aktiv: input.aktiv })
        .where(eq(bankAccounts.id, input.id));
      return { ok: true };
    }),

  /** Löschen nur möglich, wenn das Konto in keiner Rechnung referenziert ist. */
  delete: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const refs = await db
        .select({ id: invoices.id })
        .from(invoices)
        .where(eq(invoices.bankAccountId, input.id))
        .limit(1);
      if (refs.length > 0) {
        throw new Error(
          "Konto wird in Rechnungen verwendet und kann nicht gelöscht werden (deaktivieren stattdessen).",
        );
      }
      await db.delete(bankAccounts).where(eq(bankAccounts.id, input.id));
      return { ok: true };
    }),
});
