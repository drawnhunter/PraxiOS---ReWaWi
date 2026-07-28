// ── Etiketten-Generator (Code128-Barcodes als PDF) ─────────────────────────
// Fuer mobile Etikettendrucker: ein Label pro Position mit Barcode
// (Artikelnummer, Barcode oder P-<id> als Inhalt), Name und Preis.
import { z } from "zod";
import PDFDocument from "pdfkit";
import bwipjs from "bwip-js";
import { authedQuery, createRouter } from "./middleware";
import { getDb } from "./queries/connection";
import { FONT_BOLD, FONT_REGULAR } from "./pdf";
import { products } from "@db/schema";
import { inArray } from "drizzle-orm";

const GROESSEN: Record<string, { b: number; h: number }> = {
  "50x30": { b: 141.7, h: 85.0 }, // 50 x 30 mm
  "60x40": { b: 170.1, h: 113.4 },
  "70x50": { b: 198.4, h: 141.7 },
};

export const labelRouter = createRouter({
  etiketten: authedQuery
    .input(
      z.object({
        ids: z.array(z.number()).min(1),
        groesse: z.enum(["50x30", "60x40", "70x50"]).default("50x30"),
        exemplare: z.number().int().min(1).max(10).default(1),
      }),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const liste = await db
        .select()
        .from(products)
        .where(inArray(products.id, input.ids));
      if (liste.length === 0) throw new Error("Keine Produkte gefunden.");

      const { b: LW, h: LH } = GROESSEN[input.groesse];
      const doc = new PDFDocument({
        size: [LW, LH],
        margins: { top: 4, bottom: 4, left: 6, right: 6 },
        bufferPages: true,
        font: FONT_REGULAR(),
      });
      const chunks: Buffer[] = [];
      doc.on("data", (c) => chunks.push(c));
      const fertig = new Promise<Buffer>((resolve) =>
        doc.on("end", () => resolve(Buffer.concat(chunks))),
      );

      let seite = 0;
      for (const p of liste) {
        const code = p.artikelnummer || p.barcode || `P-${p.id}`;
        let barcodePng: Buffer | null = null;
        try {
          barcodePng = await bwipjs.toBuffer({
            bcid: "code128",
            text: code,
            scale: 2,
            height: LH * 0.32,
            includetext: false,
          });
        } catch {
          barcodePng = null;
        }

        for (let i = 0; i < input.exemplare; i++) {
          if (seite > 0) doc.addPage();
          seite++;
          const innenW = LW - 12;
          doc
            .font(FONT_BOLD())
            .fontSize(LH > 100 ? 8.5 : 7)
            .text(p.name, 6, 6, { width: innenW, height: LH * 0.24, ellipsis: true });
          if (barcodePng) {
            const bildH = LH * 0.38;
            const bildW = Math.min(innenW, bildH * 3);
            doc.image(barcodePng, 6, LH * 0.3, {
              fit: [bildW, bildH],
              align: "center",
            });
          }
          doc
            .font(FONT_REGULAR())
            .fontSize(LH > 100 ? 8 : 6.5)
            .text(
              `${code}${p.ekPreisNetto ? `   EK ${Number(p.ekPreisNetto).toFixed(2).replace(".", ",")} €` : ""}`,
              6,
              LH * 0.72,
              { width: innenW, align: "center" },
            );
          if (p.kategorie) {
            doc
              .fontSize(5.5)
              .fillColor("#666666")
              .text(p.kategorie, 6, LH - 12, { width: innenW, align: "center" });
            doc.fillColor("#000000");
          }
        }
      }
      doc.end();
      const pdf = await fertig;
      return {
        dateiname: `Etiketten ${liste.length} Artikel.pdf`,
        base64: pdf.toString("base64"),
      };
    }),
});
