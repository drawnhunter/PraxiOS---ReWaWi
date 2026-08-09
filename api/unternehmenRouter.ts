// ── Company Control (v1.6): freie Kennwerte mit Beleg-Verknuepfung ──────────
import { z } from "zod";
import { authedQuery, createRouter } from "./middleware";
import { getDb } from "./queries/connection";
import { companyKennwerte, postEingang } from "@db/schema";
import { asc, eq } from "drizzle-orm";

const kennwertInput = z.object({
  name: z.string().min(1).max(120),
  wert: z.string().min(1).max(255),
  postEingangId: z.number().nullable().optional(),
  sortierung: z.number().int().default(0),
});

export const unternehmenRouter = createRouter({
  /** Freie Kennwerte inkl. Beleg-Name (falls verknuepft). */
  kennwerte: authedQuery.query(async () => {
    return getDb()
      .select({
        k: companyKennwerte,
        belegName: postEingang.originalname,
      })
      .from(companyKennwerte)
      .leftJoin(postEingang, eq(companyKennwerte.postEingangId, postEingang.id))
      .orderBy(asc(companyKennwerte.sortierung), asc(companyKennwerte.id));
  }),

  kennwertAnlegen: authedQuery.input(kennwertInput).mutation(async ({ input }) => {
    const [{ id }] = await getDb()
      .insert(companyKennwerte)
      .values({ ...input, postEingangId: input.postEingangId ?? null })
      .$returningId();
    return { id };
  }),

  kennwertAktualisieren: authedQuery
    .input(z.object({ id: z.number(), data: kennwertInput }))
    .mutation(async ({ input }) => {
      await getDb()
        .update(companyKennwerte)
        .set({ ...input.data, postEingangId: input.data.postEingangId ?? null })
        .where(eq(companyKennwerte.id, input.id));
      return { ok: true };
    }),

  kennwertLoeschen: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await getDb().delete(companyKennwerte).where(eq(companyKennwerte.id, input.id));
      return { ok: true };
    }),

  /** Waehlbare Belege aus dem Post Manager (fuer die Verknuepfung). */
  belegAuswahl: authedQuery.query(async () => {
    return getDb()
      .select({
        id: postEingang.id,
        originalname: postEingang.originalname,
        stichwort: postEingang.stichwort,
        typ: postEingang.typ,
      })
      .from(postEingang)
      .orderBy(asc(postEingang.id))
      .limit(300);
  }),
});
