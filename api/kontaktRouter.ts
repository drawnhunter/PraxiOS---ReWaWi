// ── Kontakte-Kartei: CRUD + Extraktion (Vorschau/Übernehmen) ────────────────
import { z } from "zod";
import { adminQuery, authedQuery, createRouter } from "./middleware";
import { getDb } from "./queries/connection";
import { kontakte } from "@db/schema";
import { asc, eq, like, or } from "drizzle-orm";
import { extrahiereKandidaten, uebernehmeKandidaten } from "./lib/kontaktExtraktion";

const kontaktInput = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email().max(320),
  telefon: z.string().max(60).nullable().optional(),
  firma: z.string().max(255).nullable().optional(),
  notiz: z.string().nullable().optional(),
});

export const kontaktRouter = createRouter({
  liste: authedQuery
    .input(z.object({ q: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const q = input?.q?.trim();
      const rows = await db
        .select()
        .from(kontakte)
        .where(
          q
            ? or(
                like(kontakte.name, `%${q}%`),
                like(kontakte.email, `%${q}%`),
                like(kontakte.firma, `%${q}%`),
                like(kontakte.notiz, `%${q}%`),
              )
            : undefined,
        )
        .orderBy(asc(kontakte.name));
      return rows;
    }),

  anlegen: authedQuery.input(kontaktInput).mutation(async ({ input }) => {
    const db = getDb();
    const vorhanden = await db.query.kontakte.findFirst({
      where: eq(kontakte.email, input.email.toLowerCase()),
    });
    if (vorhanden) throw new Error(`Kontakt existiert bereits (#${vorhanden.id} ${vorhanden.name}).`);
    const [{ id }] = await db
      .insert(kontakte)
      .values({ ...input, email: input.email.toLowerCase(), quelle: "manuell", erstelltVon: "mensch" })
      .$returningId();
    return { id };
  }),

  aktualisieren: authedQuery
    .input(kontaktInput.partial().extend({ id: z.number() }))
    .mutation(async ({ input }) => {
      const { id, ...rest } = input;
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rest)) {
        if (v !== undefined) patch[k] = k === "email" ? (v as string).toLowerCase() : v;
      }
      if (Object.keys(patch).length === 0) throw new Error("Nichts zu ändern.");
      await getDb().update(kontakte).set(patch).where(eq(kontakte.id, id));
      return { ok: true };
    }),

  loeschen: authedQuery.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await getDb().delete(kontakte).where(eq(kontakte.id, input.id));
    return { ok: true };
  }),

  /** Extraktion: Vorschau (nichts wird geschrieben) — KI/Mensch kuratiert danach. */
  extraktionVorschau: authedQuery
    .input(z.object({ kontoId: z.number().optional() }))
    .query(async ({ input }) => {
      const kandidaten = await extrahiereKandidaten(input.kontoId);
      return {
        anzahl: kandidaten.length,
        neu: kandidaten.filter((k) => !k.bereitsVorhanden).length,
        kandidaten,
      };
    }),

  /** Extraktion anwenden: ausgewählte Kandidaten als Kontakte speichern. */
  extraktionUebernehmen: adminQuery
    .input(
      z.object({
        kandidaten: z
          .array(z.object({ email: z.string().email(), name: z.string().min(1).max(255) }))
          .min(1)
          .max(500),
      }),
    )
    .mutation(async ({ input }) => {
      return uebernehmeKandidaten(input.kandidaten);
    }),
});
