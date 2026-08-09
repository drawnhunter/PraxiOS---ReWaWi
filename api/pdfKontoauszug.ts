// ── Kontoauszug-/Transaktionsuebersicht als PDF (Banking v1.3) ─────────────
import PDFDocument from "pdfkit";
import { FONT_REGULAR, FONT_BOLD } from "./pdf";
import { getDb } from "./queries/connection";
import {
  bankAccounts,
  bankTransaktionen,
  invoices,
  incomingInvoices,
  companySettings,
} from "@db/schema";
import { and, asc, eq, gte, lte } from "drizzle-orm";

const PAGE_W = 595.28;
const MARGIN = 46;
const CONTENT_W = PAGE_W - 2 * MARGIN;

const fmtG = (v: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(v);
const fmtD = (iso: string | null | undefined) => {
  if (!iso) return "–";
  const [j, m, t] = iso.split("-");
  return `${t}.${m}.${j}`;
};

export interface KontoauszugDaten {
  konto: { bezeichnung: string; bankName: string; iban: string };
  firmaName: string;
  von: string | null;
  bis: string | null;
  erstelltAm: string;
  zeilen: {
    datum: string;
    name: string;
    zweck: string;
    betrag: number;
    saldo: number | null;
    zuordnung: string | null; // z. B. "RE 2026-003 · Kunde" oder "ER 4711 · Lieferant"
  }[];
  summeEin: number;
  summeAus: number;
  saldoStart: number | null;
  saldoEnde: number | null;
}

export function renderKontoauszugPdf(d: KontoauszugDaten): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: MARGIN, bottom: 60, left: MARGIN, right: MARGIN },
      bufferPages: true,
      font: FONT_REGULAR(),
      info: { Title: `Kontoauszug ${d.konto.bezeichnung}`, Author: d.firmaName },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const bold = FONT_BOLD();
    const regular = FONT_REGULAR();
    const DARK = "#1a1a1a";
    const GRAU = "#6b7280";

    // ── Kopf ───────────────────────────────────────────────────────────────
    let y = MARGIN;
    doc.font(bold).fontSize(15).fillColor(DARK).text("Kontoauszug", MARGIN, y);
    doc.font(regular).fontSize(9).fillColor(GRAU).text(d.firmaName, MARGIN, y + 2, {
      width: CONTENT_W, align: "right",
    });
    y += 24;
    doc.font(bold).fontSize(10).fillColor(DARK).text(d.konto.bezeichnung, MARGIN, y);
    doc.font(regular).fontSize(9).fillColor(GRAU)
      .text(`${d.konto.bankName} · IBAN ${d.konto.iban}`, MARGIN, y + 13);
    const zeitraum = d.von && d.bis ? `${fmtD(d.von)} – ${fmtD(d.bis)}` : "alle Buchungen";
    doc.text(`Zeitraum: ${zeitraum} · Erstellt am ${fmtD(d.erstelltAm)}`, MARGIN, y + 26);
    y += 46;

    // ── Summen-Box ─────────────────────────────────────────────────────────
    const boxH = 40;
    doc.roundedRect(MARGIN, y, CONTENT_W, boxH, 4).fill("#f5f5f4");
    const drittel = CONTENT_W / 3;
    doc.font(regular).fontSize(7.5).fillColor(GRAU)
      .text("EINGÄNGE", MARGIN + 12, y + 8)
      .text("AUSGÄNGE", MARGIN + drittel + 12, y + 8)
      .text(d.saldoEnde !== null ? "SALDO ENDE" : "SALDO", MARGIN + 2 * drittel + 12, y + 8);
    doc.font(bold).fontSize(11).fillColor("#15803d")
      .text(fmtG(d.summeEin), MARGIN + 12, y + 20);
    doc.fillColor("#b91c1c")
      .text(fmtG(d.summeAus), MARGIN + drittel + 12, y + 20);
    doc.fillColor(DARK)
      .text(d.saldoEnde !== null ? fmtG(d.saldoEnde) : "–", MARGIN + 2 * drittel + 12, y + 20);
    y += boxH + 16;

    // ── Tabelle ────────────────────────────────────────────────────────────
    const col = { datum: 0, name: 52, betrag: 300, saldo: 372, zuord: 436 };
    const kopf = () => {
      doc.font(bold).fontSize(7.5).fillColor(GRAU);
      doc.text("DATUM", MARGIN + col.datum, y);
      doc.text("EMPFAENGER/ZWECK", MARGIN + col.name, y);
      doc.text("BETRAG", MARGIN + col.betrag, y, { width: 66, align: "right" });
      doc.text("SALDO", MARGIN + col.saldo, y, { width: 60, align: "right" });
      doc.text("ZUORDNUNG", MARGIN + col.zuord, y);
      y += 12;
      doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_W, y).lineWidth(0.7).strokeColor("#d6d3d1").stroke();
      y += 6;
    };
    kopf();

    let saldoLauf = d.saldoStart;
    for (const z of d.zeilen) {
      const zeilenH = 26;
      if (y + zeilenH > 595.28 - 60) {
        doc.addPage();
        y = MARGIN;
        kopf();
      }
      if (saldoLauf !== null) saldoLauf += z.betrag;
      doc.font(regular).fontSize(8).fillColor(GRAU).text(fmtD(z.datum), MARGIN + col.datum, y, { width: 48 });
      doc.font(regular).fontSize(8).fillColor(DARK)
        .text(z.name || "—", MARGIN + col.name, y, { width: 240, ellipsis: true });
      if (z.zweck) {
        doc.font(regular).fontSize(7).fillColor(GRAU)
          .text(z.zweck, MARGIN + col.name, y + 10, { width: 240, ellipsis: true });
      }
      doc.font(bold).fontSize(8)
        .fillColor(z.betrag >= 0 ? "#15803d" : "#b91c1c")
        .text(fmtG(z.betrag), MARGIN + col.betrag, y, { width: 66, align: "right" });
      const saldoAnzeige = z.saldo ?? saldoLauf;
      doc.font(regular).fontSize(8).fillColor(DARK)
        .text(saldoAnzeige !== null ? fmtG(saldoAnzeige) : "–", MARGIN + col.saldo, y, { width: 60, align: "right" });
      doc.font(regular).fontSize(7).fillColor(GRAU)
        .text(z.zuordnung ?? "", MARGIN + col.zuord, y, { width: CONTENT_W - col.zuord, ellipsis: true });
      y += zeilenH;
    }

    if (d.zeilen.length === 0) {
      doc.font(regular).fontSize(9).fillColor(GRAU).text("Keine Buchungen im gewaehlten Zeitraum.", MARGIN, y + 8);
    }

    // ── Seitenzahlen ───────────────────────────────────────────────────────
    const seiten = doc.bufferedPageRange();
    for (let i = 0; i < seiten.count; i++) {
      doc.switchToPage(i);
      doc.font(regular).fontSize(7.5).fillColor(GRAU)
        .text(`${d.konto.bezeichnung} · Seite ${i + 1} von ${seiten.count}`, MARGIN, 595.28 - 40, {
          width: CONTENT_W, align: "center",
        });
    }

    doc.end();
  });
}

/** Laedt die Daten und erzeugt das PDF (fuer den tRPC-Endpunkt). */
export async function erstelleKontoauszugPdf(
  bankAccountId: number,
  von: string | null,
  bis: string | null,
): Promise<{ pdf: Buffer; dateiname: string }> {
  const db = getDb();
  const konto = await db.query.bankAccounts.findFirst({ where: eq(bankAccounts.id, bankAccountId) });
  if (!konto) throw new Error("Bankkonto nicht gefunden.");
  const firma = await db.query.companySettings.findFirst({ where: eq(companySettings.id, 1) });

  const bed = [eq(bankTransaktionen.bankAccountId, bankAccountId)];
  if (von) bed.push(gte(bankTransaktionen.datum, von));
  if (bis) bed.push(lte(bankTransaktionen.datum, bis));

  const rows = await db
    .select({
      t: bankTransaktionen,
      rechnungNummer: invoices.nummer,
      rechnungKunde: invoices.kundeName,
      eingangNummer: incomingInvoices.nummer,
      eingangLieferant: incomingInvoices.lieferantName,
    })
    .from(bankTransaktionen)
    .leftJoin(invoices, eq(bankTransaktionen.invoiceId, invoices.id))
    .leftJoin(incomingInvoices, eq(bankTransaktionen.incomingInvoiceId, incomingInvoices.id))
    .where(and(...bed))
    .orderBy(asc(bankTransaktionen.datum), asc(bankTransaktionen.id));

  const zeilen = rows.map((r) => ({
    datum: r.t.datum,
    name: r.t.name,
    zweck: r.t.zweck ?? "",
    betrag: Number(r.t.betrag),
    saldo: r.t.saldoNach !== null ? Number(r.t.saldoNach) : null,
    zuordnung:
      r.t.status === "zugeordnet"
        ? r.rechnungNummer
          ? `RE ${r.rechnungNummer} · ${r.rechnungKunde ?? ""}`
          : r.eingangNummer
            ? `ER ${r.eingangNummer} · ${r.eingangLieferant ?? ""}`
            : null
        : r.t.status === "ignoriert"
          ? "ignoriert"
          : null,
  }));

  const summeEin = zeilen.filter((z) => z.betrag > 0).reduce((a, z) => a + z.betrag, 0);
  const summeAus = zeilen.filter((z) => z.betrag < 0).reduce((a, z) => a + -z.betrag, 0);
  const hatSalden = zeilen.some((z) => z.saldo !== null);
  const saldoEnde = hatSalden ? [...zeilen].reverse().find((z) => z.saldo !== null)?.saldo ?? null : null;
  // Laufender Saldo nur anzeigen, wenn wir einen Startpunkt haben
  const saldoStart = hatSalden
    ? (() => {
        const erste = zeilen.find((z) => z.saldo !== null);
        return erste ? erste.saldo! - erste.betrag : null;
      })()
    : null;

  const pdf = await renderKontoauszugPdf({
    konto: { bezeichnung: konto.bezeichnung, bankName: konto.bankName, iban: konto.iban },
    firmaName: firma?.name ?? "",
    von,
    bis,
    erstelltAm: new Date().toISOString().slice(0, 10),
    zeilen,
    summeEin,
    summeAus,
    saldoStart,
    saldoEnde,
  });

  const zr = von && bis ? `${von}_${bis}` : "gesamt";
  return { pdf, dateiname: `Kontoauszug_${konto.bezeichnung.replace(/[^\w-]+/g, "_")}_${zr}.pdf` };
}
