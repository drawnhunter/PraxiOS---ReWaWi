// ── Berichtszentrale (tRPC): Katalog, Bericht als JSON, Bericht als PDF ────
import { z } from "zod";
import { authedQuery, createRouter } from "./middleware";
import { BERICHT_KATALOG, baueBericht } from "./lib/berichte";

const params = z.object({
  von: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  bis: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kontoId: z.number().optional(),
  satz: z.number().min(1).max(60).optional(),
});

export const berichteRouter = createRouter({
  katalog: authedQuery.query(() => BERICHT_KATALOG),

  bericht: authedQuery
    .input(params.extend({ id: z.string() }))
    .query(async ({ input }) => {
      const { id, ...p } = input;
      return baueBericht(id, p);
    }),

  pdf: authedQuery
    .input(params.extend({ id: z.string() }))
    .query(async ({ input }) => {
      const { id, ...p } = input;
      const bericht = await baueBericht(id, p);
      const { renderBerichtPdf } = await import("./lib/berichtPdf");
      const pdf = await renderBerichtPdf(bericht);
      const datei = `${bericht.id}_${bericht.zeitraum.von}_${bericht.zeitraum.bis}.pdf`.replaceAll("—", "-");
      return { dateiname: datei, base64: pdf.toString("base64") };
    }),

  /** Konten für die Kontenblatt-Auswahl. */
  konten: authedQuery.query(async () => {
    const { bankAccounts } = await import("@db/schema");
    const { getDb } = await import("./queries/connection");
    const rows = await getDb().select().from(bankAccounts);
    return rows.map((k) => ({ id: k.id, bezeichnung: k.bezeichnung, iban: k.iban }));
  }),
});
