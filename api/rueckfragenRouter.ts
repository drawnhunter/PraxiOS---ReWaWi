// ── Klärungen am Beleg (Kanzlei-Arbeitsplatz) ─────────────────────────────
// Rückfrage der Kanzlei → Antwort des Mandanten → „geklärt" durch die Kanzlei.
// Kanzlei-Rolle hat hier ihren einzigen Schreibbereich (Gate in middleware.ts).
import { z } from "zod";
import { authedQuery, createRouter } from "./middleware";
import { getDb } from "./queries/connection";
import { belegKlaerungen, incomingInvoices } from "@db/schema";
import { asc, desc, eq, ne } from "drizzle-orm";

export const rueckfragenRouter = createRouter({
  /** Alle Klärungen (optional nach Status), mit Beleg-Kopfdaten. */
  liste: authedQuery
    .input(z.object({ status: z.enum(["offen", "beantwortet", "geklaert", "aktiv"]).optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const status = input?.status;
      const bedingung =
        status === "aktiv" || !status
          ? status === "aktiv" ? ne(belegKlaerungen.status, "geklaert") : undefined
          : eq(belegKlaerungen.status, status);
      const rows = await db
        .select({ k: belegKlaerungen, lieferant: incomingInvoices.lieferantName, nummer: incomingInvoices.nummer, brutto: incomingInvoices.brutto, datum: incomingInvoices.rechnungsdatum })
        .from(belegKlaerungen)
        .leftJoin(incomingInvoices, eq(belegKlaerungen.incomingInvoiceId, incomingInvoices.id))
        .where(bedingung)
        .orderBy(asc(belegKlaerungen.status), desc(belegKlaerungen.updatedAt))
        .limit(200);
      return rows.map((r) => ({
        id: r.k.id,
        incomingInvoiceId: r.k.incomingInvoiceId,
        frage: r.k.frage,
        antwort: r.k.antwort,
        status: r.k.status,
        frageVon: r.k.frageVon,
        antwortVon: r.k.antwortVon,
        aktualisiert: r.k.updatedAt,
        beleg: r.lieferant ? { lieferant: r.lieferant, nummer: r.nummer, brutto: r.brutto, datum: r.datum } : null,
      }));
    }),

  /** Klärung zu einem Beleg (eine je Beleg). */
  zuBeleg: authedQuery
    .input(z.object({ incomingInvoiceId: z.number() }))
    .query(async ({ input }) => {
      const row = await getDb().query.belegKlaerungen.findFirst({
        where: eq(belegKlaerungen.incomingInvoiceId, input.incomingInvoiceId),
      });
      return row ?? null;
    }),

  /** Rückfrage stellen (Kanzlei) — oder Frage aktualisieren, solange unbeantwortet. */
  erstellen: authedQuery
    .input(z.object({ incomingInvoiceId: z.number(), frage: z.string().min(2).max(2000) }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const beleg = await db.query.incomingInvoices.findFirst({ where: eq(incomingInvoices.id, input.incomingInvoiceId) });
      if (!beleg) throw new Error("Beleg nicht gefunden.");
      const von = ctx.user?.username ?? ctx.user?.name ?? "unbekannt";
      const vorhanden = await db.query.belegKlaerungen.findFirst({
        where: eq(belegKlaerungen.incomingInvoiceId, input.incomingInvoiceId),
      });
      if (vorhanden) {
        if (vorhanden.status === "geklaert") throw new Error("Diese Klärung ist bereits geklärt — bei Bedarf neue Sichtung.");
        await db
          .update(belegKlaerungen)
          .set({ frage: input.frage, status: "offen", antwort: null, antwortVon: null, frageVon: von })
          .where(eq(belegKlaerungen.id, vorhanden.id));
        return { ok: true, id: vorhanden.id };
      }
      const [{ id }] = await db
        .insert(belegKlaerungen)
        .values({ incomingInvoiceId: input.incomingInvoiceId, frage: input.frage, frageVon: von })
        .$returningId();
      return { ok: true, id };
    }),

  /** Antwort des Mandanten (status → beantwortet). */
  antworten: authedQuery
    .input(z.object({ incomingInvoiceId: z.number(), antwort: z.string().min(1).max(2000) }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const row = await db.query.belegKlaerungen.findFirst({
        where: eq(belegKlaerungen.incomingInvoiceId, input.incomingInvoiceId),
      });
      if (!row) throw new Error("Keine Klärung zu diesem Beleg.");
      const von = ctx.user?.username ?? ctx.user?.name ?? "unbekannt";
      await db
        .update(belegKlaerungen)
        .set({ antwort: input.antwort, antwortVon: von, status: "beantwortet" })
        .where(eq(belegKlaerungen.id, row.id));
      return { ok: true };
    }),

  /** Als geklärt schließen (beide Seiten). */
  klaeren: authedQuery
    .input(z.object({ incomingInvoiceId: z.number() }))
    .mutation(async ({ input }) => {
      await getDb()
        .update(belegKlaerungen)
        .set({ status: "geklaert" })
        .where(eq(belegKlaerungen.incomingInvoiceId, input.incomingInvoiceId));
      return { ok: true };
    }),
});
