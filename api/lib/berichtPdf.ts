// ── Generischer Berichts-PDF-Renderer (pdfkit) — eine Engine für alle Berichte ─
import PDFDocument from "pdfkit";
import { FONT_REGULAR, FONT_BOLD } from "../pdf";
import type { Bericht } from "./berichte";
import { ladeFirmaLive } from "../pdfBelege";

const MARGIN = 42;
const TEAL = "#0f766e";
const DARK = "#171412";
const GRAU = "#78716c";
const LINE = "#e7e5e4";

function fmtZelle(v: string | number | null, rechts: boolean): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number" && rechts) {
    return v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return String(v);
}

/** Rendert einen Bericht als PDF (A4, Markenstil, Tabellen mit Zebra + Summenzeile). */
export async function renderBerichtPdf(b: Bericht): Promise<Buffer> {
  const firma = await ladeFirmaLive().catch(() => ({ name: "" }) as { name?: string });
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: MARGIN, info: { Title: `${b.titel} — PraxiOS ReWaWi` } });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const bold = FONT_BOLD();
    const regular = FONT_REGULAR();
    const contentW = doc.page.width - 2 * MARGIN;
    const n = b.spalten.length;
    // Spaltenbreiten: erste Spalte flexibel, rechte Spalten kompakt
    const rechte = b.spalten.filter((s) => s.rechts).length;
    const rechteW = Math.min(95, (contentW * 0.62) / Math.max(1, rechte));
    const linkeW = (contentW - rechte * rechteW) / Math.max(1, n - rechte);
    const colX = b.spalten.reduce<number[]>((acc, _s, i) => {
      acc.push(i === 0 ? 0 : acc[i - 1] + (b.spalten[i - 1].rechts ? rechteW : linkeW));
      return acc;
    }, []);
    const colW = b.spalten.map((s) => (s.rechts ? rechteW : linkeW));

    let y = MARGIN;
    // Kopf
    doc.font(bold).fontSize(16).fillColor(TEAL).text("ReWaWi Bericht", MARGIN, y);
    doc.font(regular).fontSize(8.5).fillColor(GRAU).text(firma.name ?? "", MARGIN, y + 2, { width: contentW, align: "right" });
    y += 22;
    doc.font(bold).fontSize(12.5).fillColor(DARK).text(b.titel, MARGIN, y);
    y += 16;
    doc.font(regular).fontSize(8.5).fillColor(GRAU)
      .text(`Zeitraum: ${b.zeitraum.von} – ${b.zeitraum.bis} · Erstellt am ${new Date().toLocaleDateString("de-DE")}`, MARGIN, y);
    y += 10;
    if (b.beschreibung) {
      doc.font(regular).fontSize(8.5).fillColor(GRAU).text(b.beschreibung, MARGIN, y, { width: contentW });
      y += 8;
    }
    y += 8;

    const seitenUmbruch = (bedarf: number) => {
      if (y + bedarf > doc.page.height - MARGIN - 30) {
        doc.addPage();
        y = MARGIN;
        tabellenKopf();
      }
    };

    const tabellenKopf = () => {
      doc.rect(MARGIN, y, contentW, 16).fill("#f5f5f4");
      doc.font(bold).fontSize(7.5).fillColor(GRAU);
      b.spalten.forEach((s, i) => {
        doc.text(s.titel.toUpperCase(), MARGIN + colX[i] + 3, y + 5, {
          width: colW[i] - 6, align: s.rechts ? "right" : "left",
        });
      });
      y += 20;
    };

    tabellenKopf();
    let zebra = false;
    for (const z of b.zeilen) {
      const werte = z.zellen.map((v, i) => fmtZelle(v, b.spalten[i]?.rechts ?? false));
      const hoehe = Math.max(
        13,
        ...werte.map((w, i) => doc.font(regular).fontSize(8.5).heightOfString(w, { width: colW[i] - 6 }) + 6),
      );
      seitenUmbruch(hoehe + 4);
      if (z.stark) {
        doc.rect(MARGIN, y - 2, contentW, hoehe + 2).fill("#f0fdfa");
      } else if (zebra) {
        doc.rect(MARGIN, y - 2, contentW, hoehe + 2).fill("#fafaf9");
      }
      zebra = !zebra;
      werte.forEach((w, i) => {
        const x = MARGIN + colX[i] + 3 + (z.ebene ? z.ebene * 10 : 0);
        doc.font(z.stark ? bold : regular).fontSize(8.5)
          .fillColor(z.stark ? TEAL : DARK)
          .text(w, x, y + 3, { width: colW[i] - 6 - (z.ebene ? z.ebene * 10 : 0), align: b.spalten[i]?.rechts ? "right" : "left" });
      });
      y += hoehe + 1;
    }

    if (b.summenZeile) {
      y += 4;
      seitenUmbruch(22);
      doc.moveTo(MARGIN, y).lineTo(MARGIN + contentW, y).lineWidth(1).strokeColor(TEAL).stroke();
      y += 6;
      b.summenZeile.forEach((v, i) => {
        doc.font(bold).fontSize(9).fillColor(TEAL)
          .text(fmtZelle(v, b.spalten[i]?.rechts ?? false), MARGIN + colX[i] + 3, y, {
            width: colW[i] - 6, align: b.spalten[i]?.rechts ? "right" : "left",
          });
      });
      y += 18;
    }

    if (b.hinweise?.length) {
      y += 8;
      seitenUmbruch(14 * b.hinweise.length + 10);
      doc.font(bold).fontSize(8).fillColor(GRAU).text("Hinweise", MARGIN, y);
      y += 11;
      for (const h of b.hinweise) {
        doc.font(regular).fontSize(7.8).fillColor(GRAU).text(`• ${h}`, MARGIN, y, { width: contentW });
        y = doc.y + 3;
      }
    }

    doc.moveTo(MARGIN, doc.page.height - MARGIN - 12).lineTo(MARGIN + contentW, doc.page.height - MARGIN - 12).lineWidth(0.5).strokeColor(LINE).stroke();
    doc.font(regular).fontSize(7).fillColor(GRAU)
      .text("Erstellt mit PraxiOS ReWaWi (Open Source, AGPL-3.0) — lokal auf deiner Instanz", MARGIN, doc.page.height - MARGIN - 8, { width: contentW, align: "center" });

    doc.end();
  });
}
