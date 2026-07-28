// ── PDF-Download über tRPC (Base64) ─────────────────────────────────────────
// Hintergrund: In manchen Hosting-/Vorschau-Umgebungen werden direkte
// Binär-Downloads über eigene Routen blockiert (403). Der Weg über die
// tRPC-API funktioniert überall, weil er denselben Kanal wie die App nutzt.
import { z } from "zod";
import { authedQuery, createRouter } from "./middleware";
import { renderBelegPdf, BELEG_TITEL } from "./pdf";
import {
  ladeRechnungsBeleg,
  ladeGutschriftsBeleg,
  ladeLieferscheinBeleg,
  ladeBestellungsBeleg,
  ladeAngebotsBeleg,
  ladeDesign,
} from "./pdfBelege";

async function alsBase64(
  lade: (id: number) => Promise<{ beleg: Parameters<typeof renderBelegPdf>[0]; dateiname: string }>,
  id: number,
) {
  const { beleg, dateiname } = await lade(id);
  const design = await ladeDesign();
  const pdf = await renderBelegPdf(beleg, design);
  return {
    dateiname: `${BELEG_TITEL[beleg.art]} ${dateiname}.pdf`,
    base64: pdf.toString("base64"),
  };
}

const idInput = z.object({ id: z.number() });

export const pdfRouter = createRouter({
  invoice: authedQuery.input(idInput).query(({ input }) =>
    alsBase64(ladeRechnungsBeleg, input.id),
  ),
  credit: authedQuery.input(idInput).query(({ input }) =>
    alsBase64(ladeGutschriftsBeleg, input.id),
  ),
  delivery: authedQuery.input(idInput).query(({ input }) =>
    alsBase64(ladeLieferscheinBeleg, input.id),
  ),
  order: authedQuery.input(idInput).query(({ input }) =>
    alsBase64(ladeBestellungsBeleg, input.id),
  ),
  offer: authedQuery.input(idInput).query(({ input }) =>
    alsBase64(ladeAngebotsBeleg, input.id),
  ),
});
