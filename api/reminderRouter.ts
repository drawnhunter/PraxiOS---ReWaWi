// ── Mahnwesen: Zahlungserinnerungen und Mahnungen zu Rechnungen ─────────────
import { z } from "zod";
import { authedQuery, createRouter } from "./middleware";
import { getDb } from "./queries/connection";
import { reminders, invoices } from "@db/schema";
import { eq, asc, desc } from "drizzle-orm";
import { renderMahnungPdf, MAHN_STUFEN } from "./pdf";
import { ladeFirmaLive } from "./pdfBelege";

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format: JJJJ-MM-TT");

function heute(): string {
  return new Date().toISOString().slice(0, 10);
}

function plusTage(iso: string, tage: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + tage);
  return d.toISOString().slice(0, 10);
}

export const reminderRouter = createRouter({
  listByInvoice: authedQuery
    .input(z.object({ invoiceId: z.number() }))
    .query(async ({ input }) => {
      return getDb().query.reminders.findMany({
        where: eq(reminders.invoiceId, input.invoiceId),
        orderBy: [asc(reminders.datum), asc(reminders.id)],
      });
    }),

  /** Nächste sinnvolle Mahnstufe + Offenbetrag für das Erstell-Formular. */
  vorschlag: authedQuery
    .input(z.object({ invoiceId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const r = await db.query.invoices.findFirst({
        where: eq(invoices.id, input.invoiceId),
        with: { reminders: true },
      });
      if (!r) throw new Error("Rechnung nicht gefunden.");
      const offen = Number(r.brutto) - Number(r.bezahltBetrag);
      const hoechste = r.reminders.reduce((m, x) => Math.max(m, x.stufe), 0);
      const ueberfaellig = r.faelligkeitsdatum < heute() && offen > 0 && r.status === "finalisiert";
      return {
        stufe: Math.min(hoechste + 1, 3) as 1 | 2 | 3,
        stufenLabel: MAHN_STUFEN,
        offenBetrag: offen.toFixed(2),
        ueberfaellig,
        letzteAm: r.reminders.length
          ? r.reminders.map((x) => x.datum).sort().at(-1)
          : null,
      };
    }),

  create: authedQuery
    .input(
      z.object({
        invoiceId: z.number(),
        stufe: z.number().int().min(1).max(3),
        zahlungsfrist: dateString.optional(),
        bemerkung: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const r = await db.query.invoices.findFirst({
        where: eq(invoices.id, input.invoiceId),
      });
      if (!r) throw new Error("Rechnung nicht gefunden.");
      if (r.status !== "finalisiert") {
        throw new Error("Mahnungen gibt es nur zu finalisierten Rechnungen.");
      }
      const offen = Number(r.brutto) - Number(r.bezahltBetrag);
      if (offen <= 0) throw new Error("Die Rechnung ist bereits vollständig bezahlt.");

      const [{ id }] = await db
        .insert(reminders)
        .values({
          invoiceId: r.id,
          stufe: input.stufe,
          datum: heute(),
          zahlungsfrist: input.zahlungsfrist ?? plusTage(heute(), 10),
          offenBetrag: offen.toFixed(2),
          bemerkung: input.bemerkung ?? null,
        })
        .$returningId();
      return { id };
    }),

  delete: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await getDb().delete(reminders).where(eq(reminders.id, input.id));
      return { ok: true };
    }),

  /** Überfällige Rechnungen (für Übersicht/Badge). */
  ueberfaellig: authedQuery.query(async () => {
    const rows = await getDb().query.invoices.findMany({
      where: eq(invoices.status, "finalisiert"),
      orderBy: [desc(invoices.faelligkeitsdatum)],
    });
    const h = heute();
    return rows.filter(
      (r) => r.faelligkeitsdatum < h && Number(r.brutto) - Number(r.bezahltBetrag) > 0.004,
    );
  }),

  pdf: authedQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const m = await getDb().query.reminders.findFirst({
        where: eq(reminders.id, input.id),
        with: { invoice: true },
      });
      if (!m) throw new Error("Mahnung nicht gefunden.");
      const r = m.invoice;

      const firmaSnap = r.firmenSnapshot ? JSON.parse(r.firmenSnapshot) : null;
      const firma = firmaSnap ?? (await ladeFirmaLive());
      const bankSnap = r.bankSnapshot ? JSON.parse(r.bankSnapshot) : null;

      const pdf = await renderMahnungPdf({
        stufe: m.stufe,
        datum: m.datum,
        zahlungsfrist: m.zahlungsfrist,
        offenCent: Math.round(Number(m.offenBetrag) * 100),
        bruttoCent: Math.round(Number(r.brutto) * 100),
        bezahltCent: Math.round(Number(r.bezahltBetrag) * 100),
        rechnungNummer: r.nummer ?? `#${r.id}`,
        rechnungDatum: r.rechnungsdatum,
        firma,
        bank: bankSnap ?? null,
        kunde: {
          name: r.kundeName,
          zusatz: r.kundeZusatz,
          strasse: r.kundeStrasse,
          plz: r.kundePlz,
          ort: r.kundeOrt,
          land: r.kundeLand,
        },
      });
      return {
        dateiname: `${MAHN_STUFEN[m.stufe] ?? "Mahnung"} ${r.nummer ?? r.id}.pdf`,
        base64: pdf.toString("base64"),
      };
    }),
});
