import PDFDocument from "pdfkit";
import * as fs from "fs";
import * as path from "path";
import { computeTotals } from "./queries/invoicing";

// ── Fonts (liegen im Projekt, damit sie auch im Deployment verfügbar sind) ──
function fontPath(name: string): string {
  const p = path.join(process.cwd(), "api", "assets", "fonts", name);
  if (fs.existsSync(p)) return p;
  throw new Error(`Font nicht gefunden: ${name} (erwartet unter ${p})`);
}

export const FONT_REGULAR = () => fontPath("DejaVuSans.ttf");
export const FONT_BOLD = () => fontPath("DejaVuSans-Bold.ttf");

// ── Formatierung (de-DE) ────────────────────────────────────────────────────
const nf = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
export function fmtGeld(cent: number): string {
  return nf.format(cent / 100);
}
export function fmtDatum(iso: string): string {
  const [j, m, t] = iso.split("-");
  return `${t}.${m}.${j}`;
}
function fmtMenge(menge: string | number): string {
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 3 }).format(
    Number(menge),
  );
}
function fmtIban(iban: string): string {
  return iban.replace(/(.{4})/g, "$1 ").trim();
}

// ── Beleg-Datenmodell für das PDF ───────────────────────────────────────────
export type BelegArt = "rechnung" | "gutschrift" | "lieferschein" | "bestellung" | "angebot";

export const BELEG_TITEL: Record<BelegArt, string> = {
  rechnung: "Rechnung",
  gutschrift: "Gutschrift",
  lieferschein: "Lieferschein",
  bestellung: "Bestellung",
  angebot: "Angebot",
};

export interface PdfBeleg {
  art: BelegArt;
  nummer: string;
  istEntwurf: boolean;
  datum: string;
  faellig?: string | null;
  leistungsdatum?: string | null;
  lieferdatum?: string | null;
  gueltigBis?: string | null;
  referenzNummer?: string | null;
  referenzDatum?: string | null;
  grund?: string | null;
  pdfNotiz?: string | null;
  bezahltCent?: number;
  firma: {
    name: string;
    strasse: string;
    plz: string;
    ort: string;
    land: string;
    handelsregister?: string | null;
    steuernummer?: string | null;
    ustIdNr?: string | null;
    email?: string | null;
    telefon?: string | null;
    webseite?: string | null;
    fussText?: string | null;
  };
  bank?: {
    bankName: string;
    kontoinhaber: string;
    iban: string;
    bic?: string | null;
  } | null;
  kunde: {
    name: string;
    zusatz?: string | null;
    strasse: string;
    plz: string;
    ort: string;
    land: string;
  };
  items: {
    bezeichnung: string;
    beschreibung?: string | null;
    menge: string;
    einheit: string;
    einzelpreis: string;
    ustSatz: number;
  }[];
}

// ── Layout-Konstanten ───────────────────────────────────────────────────────
const PAGE_W = 595.28;
const MARGIN = 50;
const CONTENT_W = PAGE_W - 2 * MARGIN;

interface Col {
  w: number;
  label: string;
  align: "left" | "right";
}

const COLS_PREIS: Col[] = [
  { w: 30, label: "Pos.", align: "left" },
  { w: 207, label: "Beschreibung", align: "left" },
  { w: 48, label: "Menge", align: "right" },
  { w: 52, label: "Einheit", align: "left" },
  { w: 62, label: "Preis", align: "right" },
  { w: 38, label: "USt.", align: "right" },
  { w: 58, label: "Betrag", align: "right" },
];

const COLS_MENGE: Col[] = [
  { w: 30, label: "Pos.", align: "left" },
  { w: 365, label: "Beschreibung", align: "left" },
  { w: 50, label: "Menge", align: "right" },
  { w: 50, label: "Einheit", align: "left" },
];

const GRAY = "#555555";
const LIGHT = "#999999";
const LINE = "#dddddd";
const DARK = "#1a1a1a";

// ── Design-System (Einstellungen → Design) ──────────────────────────────────
export type PdfLayoutId = "klassisch" | "modern" | "kompakt";
export interface PdfDesign {
  layout: PdfLayoutId;
  akzent: string; // Hex, z. B. "#1d4ed8"
}

export const AKZENT_HEX: Record<string, string> = {
  neutral: "#171717",
  blau: "#1d4ed8",
  gruen: "#15803d",
  bernstein: "#b45309",
  violett: "#7c3aed",
  rot: "#b91c1c",
};

export const STANDARD_DESIGN: PdfDesign = { layout: "klassisch", akzent: AKZENT_HEX.neutral };

export function renderBelegPdf(beleg: PdfBeleg, design?: PdfDesign): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: MARGIN, bottom: 70, left: MARGIN, right: MARGIN },
      bufferPages: true,
      font: FONT_REGULAR(),
      info: {
        Title: `${beleg.art === "rechnung" ? "Rechnung" : "Gutschrift"} ${beleg.nummer}`,
        Author: beleg.firma.name,
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const bold = FONT_BOLD();
    const regular = FONT_REGULAR();
    doc.font(regular);

    const totals = computeTotals(beleg.items);
    const einzelpreiseCent = beleg.items.map((it) =>
      Math.round(Number(it.einzelpreis) * 100),
    );

    // Design-Varianten
    const layout = design?.layout ?? "klassisch";
    const akzent = design?.akzent ?? DARK;
    const MODERN = layout === "modern";
    const K = layout === "kompakt";
    const basisSchrift = K ? 8.5 : 9;
    const kopfSchrift = K ? 14 : 16;
    const zeilenAbstand = K ? 11 : 13;
    const metaAbstand = K ? 12 : 14;

    // ── Kopfbereich ─────────────────────────────────────────────────────────
    let y = MARGIN;
    if (MODERN) {
      // Farbbalken ueber die gesamte Breite oben
      doc.rect(0, 0, PAGE_W, 86).fill(akzent);
      doc
        .font(bold)
        .fontSize(17)
        .fillColor("#ffffff")
        .text(beleg.firma.name, MARGIN, 26);
      doc
        .font(regular)
        .fontSize(9)
        .fillOpacity(0.85)
        .fillColor("#ffffff")
        .text(
          `${beleg.firma.strasse} · ${beleg.firma.plz} ${beleg.firma.ort}`,
          MARGIN,
          50,
        );
      const rechts: string[] = [];
      if (beleg.firma.handelsregister) rechts.push(`Handelsregister: ${beleg.firma.handelsregister}`);
      if (beleg.firma.steuernummer) rechts.push(`Steuernummer: ${beleg.firma.steuernummer}`);
      if (beleg.firma.ustIdNr) rechts.push(`USt-IdNr.: ${beleg.firma.ustIdNr}`);
      if (beleg.firma.email) rechts.push(`E-Mail: ${beleg.firma.email}`);
      if (beleg.firma.telefon) rechts.push(`Telefon: ${beleg.firma.telefon}`);
      if (beleg.firma.webseite) rechts.push(`Webseite: ${beleg.firma.webseite}`);
      doc.font(regular).fontSize(8).fillOpacity(0.85).fillColor("#ffffff");
      rechts.forEach((zeile, i) => {
        doc.text(zeile, MARGIN + 250, 22 + i * 10.5, {
          width: CONTENT_W - 250,
          align: "right",
        });
      });
      doc.fillOpacity(1);
      y = 86 + 22;
    } else {
      doc.font(bold).fontSize(kopfSchrift).fillColor(DARK).text(beleg.firma.name, MARGIN, y);
      doc
        .font(regular)
        .fontSize(basisSchrift)
        .fillColor(GRAY)
        .text(
          `${beleg.firma.strasse} · ${beleg.firma.plz} ${beleg.firma.ort}`,
          MARGIN,
          y + (K ? 18 : 22),
        );

      const rechts: string[] = [];
      if (beleg.firma.handelsregister) rechts.push(`Handelsregister: ${beleg.firma.handelsregister}`);
      if (beleg.firma.steuernummer) rechts.push(`Steuernummer: ${beleg.firma.steuernummer}`);
      if (beleg.firma.ustIdNr) rechts.push(`USt-IdNr.: ${beleg.firma.ustIdNr}`);
      if (beleg.firma.email) rechts.push(`E-Mail: ${beleg.firma.email}`);
      if (beleg.firma.telefon) rechts.push(`Telefon: ${beleg.firma.telefon}`);
      if (beleg.firma.webseite) rechts.push(`Webseite: ${beleg.firma.webseite}`);
      doc.font(regular).fontSize(8).fillColor(GRAY);
      rechts.forEach((zeile, i) => {
        doc.text(zeile, MARGIN + 250, y + i * 11, {
          width: CONTENT_W - 250,
          align: "right",
        });
      });

      y = MARGIN + Math.max(K ? 32 : 40, rechts.length * 11 + 6);
      doc
        .moveTo(MARGIN, y)
        .lineTo(PAGE_W - MARGIN, y)
        .lineWidth(0.7)
        .strokeColor(LIGHT)
        .stroke();
      y += K ? 12 : 18;
    }

    // ── Empfänger + Metadaten ───────────────────────────────────────────────
    const kundenZeilen = [
      beleg.kunde.name,
      ...(beleg.kunde.zusatz ? [beleg.kunde.zusatz] : []),
      beleg.kunde.strasse,
      `${beleg.kunde.plz} ${beleg.kunde.ort}`,
      beleg.kunde.land,
    ];
    doc.font(regular).fontSize(basisSchrift).fillColor(LIGHT).text("Empfänger", MARGIN, y);
    doc.fontSize(K ? 9 : 10).fillColor(DARK);
    kundenZeilen.forEach((zeile, i) => {
      doc.font(i === 0 ? bold : regular).text(zeile, MARGIN, y + 14 + i * zeilenAbstand);
    });

    const meta: [string, string][] = (() => {
      const titel = BELEG_TITEL[beleg.art];
      if (beleg.art === "rechnung") {
        return [
          [`${titel}:`, beleg.nummer],
          ["Rechnungsdatum:", fmtDatum(beleg.datum)],
          ...(beleg.leistungsdatum
            ? [["Leistungsdatum:", beleg.leistungsdatum] as [string, string]]
            : []),
          ...(beleg.faellig
            ? [["Fälligkeitsdatum:", fmtDatum(beleg.faellig)] as [string, string]]
            : []),
        ];
      }
      if (beleg.art === "gutschrift") {
        return [
          [`${titel}:`, beleg.nummer],
          ["Gutschriftsdatum:", fmtDatum(beleg.datum)],
          ...(beleg.referenzNummer
            ? [["Urspr. Rechnungsnr.:", beleg.referenzNummer] as [string, string]]
            : []),
          ...(beleg.referenzDatum
            ? [["Rechnungsdatum:", fmtDatum(beleg.referenzDatum)] as [string, string]]
            : []),
        ];
      }
      if (beleg.art === "lieferschein") {
        return [
          [`${titel}:`, beleg.nummer],
          ["Lieferdatum:", fmtDatum(beleg.datum)],
          ...(beleg.referenzNummer
            ? [["Zur Rechnung:", beleg.referenzNummer] as [string, string]]
            : []),
        ];
      }
      if (beleg.art === "angebot") {
        return [
          [`${titel}:`, beleg.nummer],
          ["Angebotsdatum:", fmtDatum(beleg.datum)],
          ...(beleg.gueltigBis
            ? [["Gültig bis:", fmtDatum(beleg.gueltigBis)] as [string, string]]
            : []),
        ];
      }
      // bestellung
      return [
        [`${titel}:`, beleg.nummer],
        ["Bestelldatum:", fmtDatum(beleg.datum)],
        ...(beleg.lieferdatum
          ? [["Gew. Lieferdatum:", fmtDatum(beleg.lieferdatum)] as [string, string]]
          : []),
      ];
    })();
    let my = y;
    doc.fontSize(basisSchrift);
    meta.forEach(([label, wert]) => {
      doc.font(regular).fillColor(GRAY).text(label, MARGIN + 250, my, { width: 115 });
      doc
        .font(bold)
        .fillColor(MODERN ? akzent : DARK)
        .text(wert, MARGIN + 368, my, { width: CONTENT_W - 368, align: "right" });
      my += metaAbstand;
    });

    y = Math.max(y + 14 + kundenZeilen.length * zeilenAbstand, my) + (K ? 8 : 12);

    // ── Bemerkung / Grund auf dem Beleg ─────────────────────────────────────
    const notizZeilen: string[] = [];
    if (beleg.pdfNotiz) notizZeilen.push(beleg.pdfNotiz);
    if (beleg.grund) notizZeilen.push(`Grund: ${beleg.grund}`);
    if (notizZeilen.length > 0) {
      const notizText = notizZeilen.join("\n");
      const h = doc.font(regular).fontSize(9).heightOfString(notizText, {
        width: CONTENT_W,
      });
      doc.fillColor(DARK).text(notizText, MARGIN, y, { width: CONTENT_W });
      y += h + 10;
    }

    // ── Entwurfs-Wasserzeichen ──────────────────────────────────────────────
    if (beleg.istEntwurf) {
      doc
        .font(bold)
        .fontSize(60)
        .fillColor("#f0c0c0")
        .rotate(-30, { origin: [PAGE_W / 2, 400] })
        .text("ENTWURF", PAGE_W / 2 - 160, 380, { width: 400, align: "center" })
        .rotate(30, { origin: [PAGE_W / 2, 400] });
    }

    // ── Positionstabelle ────────────────────────────────────────────────────
    const mitPreisen = beleg.art !== "lieferschein";
    const COLS = mitPreisen ? COLS_PREIS : COLS_MENGE;
    const colX = COLS.reduce<number[]>((acc, _c, i) => {
      acc.push(i === 0 ? MARGIN : acc[i - 1] + COLS[i - 1].w);
      return acc;
    }, []);

    const zeichneTabellenkopf = (yy: number) => {
      doc
        .rect(MARGIN, yy, CONTENT_W, K ? 15 : 18)
        .fillColor(MODERN ? akzent : "#f3f3f3")
        .fill();
      doc.font(bold).fontSize(8).fillColor(MODERN ? "#ffffff" : GRAY);
      COLS.forEach((c, i) => {
        doc.text(c.label, colX[i] + 4, yy + (K ? 4 : 5), {
          width: c.w - 8,
          align: c.align,
        });
      });
      return yy + (K ? 18 : 22);
    };

    const unterkante = 770;
    y = zeichneTabellenkopf(y);
    doc.font(regular).fontSize(basisSchrift);

    beleg.items.forEach((it, idx) => {
      const bezH = doc
        .font(bold)
        .heightOfString(it.bezeichnung, { width: COLS[1].w - 8 });
      const beschrH = it.beschreibung
        ? doc
            .font(regular)
            .heightOfString(it.beschreibung, { width: COLS[1].w - 8 })
        : 0;
      const zeilenH = Math.max(bezH + (beschrH ? beschrH + 3 : 0) + 10, K ? 17 : 20);

      if (y + zeilenH > unterkante) {
        doc.addPage();
        y = zeichneTabellenkopf(MARGIN);
        doc.font(regular).fontSize(basisSchrift);
      }

      const zeilenNetto = totals.zeilenNettoCent[idx];
      doc.font(regular).fontSize(basisSchrift).fillColor(GRAY);
      doc.text(String(idx + 1), colX[0] + 4, y + 5, { width: COLS[0].w - 8 });
      doc.font(bold).fillColor(DARK);
      doc.text(it.bezeichnung, colX[1] + 4, y + 5, { width: COLS[1].w - 8 });
      if (it.beschreibung) {
        doc
          .font(regular)
          .fontSize(8)
          .fillColor(GRAY)
          .text(it.beschreibung, colX[1] + 4, y + 5 + bezH + 2, {
            width: COLS[1].w - 8,
          });
        doc.fontSize(basisSchrift);
      }
      doc.font(regular).fillColor(DARK);
      doc.text(fmtMenge(it.menge), colX[2] + 4, y + 5, {
        width: COLS[2].w - 8,
        align: "right",
      });
      doc.text(it.einheit, colX[3] + 4, y + 5, { width: COLS[3].w - 8 });
      if (mitPreisen) {
        doc.text(fmtGeld(einzelpreiseCent[idx]), colX[4] + 4, y + 5, {
          width: COLS[4].w - 8,
          align: "right",
        });
        doc.text(`${it.ustSatz} %`, colX[5] + 4, y + 5, {
          width: COLS[5].w - 8,
          align: "right",
        });
        doc.text(fmtGeld(zeilenNetto), colX[6] + 4, y + 5, {
          width: COLS[6].w - 8,
          align: "right",
        });
      }

      y += zeilenH;
      doc
        .moveTo(MARGIN, y - 4)
        .lineTo(PAGE_W - MARGIN, y - 4)
        .lineWidth(0.4)
        .strokeColor(LINE)
        .stroke();
    });

    y += 12;

    if (beleg.art === "lieferschein") {
      // Kein Summenblock — Lieferschein ohne Preise
      if (y + 40 > unterkante) {
        doc.addPage();
        y = MARGIN;
      }
      doc
        .font(regular)
        .fontSize(8)
        .fillColor(GRAY)
        .text(
          "Dieser Lieferschein dient dem Nachweis der Warenübergabe — er enthält keine Preisangaben.",
          MARGIN,
          y,
          { width: CONTENT_W },
        );
      y += 20;
    } else {
      if (y + 130 > unterkante) {
        doc.addPage();
        y = MARGIN;
      }

      // ── Summenblock ───────────────────────────────────────────────────────
      const summenX = MARGIN + 235;
      const wertX = MARGIN + 400;
      const gesamtLabel =
        beleg.art === "gutschrift"
          ? "Gutschriftbetrag EUR"
          : beleg.art === "bestellung"
            ? "Bestellsumme EUR"
            : beleg.art === "angebot"
              ? "Angebotssumme EUR"
              : "Gesamt EUR";
      const summen: [string, string, boolean][] = [
        ["Zwischensumme ohne USt.", fmtGeld(totals.nettoCent), false],
        ...totals.ustProSatz.map(
          (u) =>
            [
              u.satz === 0
                ? `USt. 0 % (steuerfrei) von ${fmtGeld(u.basisCent)}`
                : `USt. ${u.satz} % von ${fmtGeld(u.basisCent)}`,
              fmtGeld(u.betragCent),
              false,
            ] as [string, string, boolean],
        ),
        [gesamtLabel, fmtGeld(totals.bruttoCent), true],
      ];
      if (beleg.art === "rechnung" && (beleg.bezahltCent ?? 0) > 0) {
        summen.push(["Bezahlter Betrag", fmtGeld(beleg.bezahltCent!), false]);
        summen.push([
          "Zu zahlender Betrag EUR",
          fmtGeld(totals.bruttoCent - beleg.bezahltCent!),
          true,
        ]);
      } else if (beleg.art === "rechnung") {
        summen.push(["Zu zahlender Betrag EUR", fmtGeld(totals.bruttoCent), true]);
      }

      doc.fontSize(basisSchrift);
      summen.forEach(([label, wert, fett]) => {
        doc
          .font(fett ? bold : regular)
          .fillColor(fett ? (MODERN ? akzent : DARK) : GRAY)
          .text(label, summenX, y, { width: 160 });
        doc
          .font(fett ? bold : regular)
          .fillColor(fett && MODERN ? akzent : DARK)
          .text(wert, wertX, y, {
            width: PAGE_W - MARGIN - wertX,
            align: "right",
          });
        y += fett ? (K ? 17 : 20) : K ? 13 : 15;
        if (fett) {
          doc
            .moveTo(summenX, y - 7)
            .lineTo(PAGE_W - MARGIN, y - 7)
            .lineWidth(0.5)
            .strokeColor(MODERN ? akzent : LIGHT)
            .stroke();
        }
      });
      y += 4;
    }

    y += 16;

    // ── Angebots-Hinweis ────────────────────────────────────────────────────
    if (beleg.art === "angebot") {
      if (y + 60 > unterkante) {
        doc.addPage();
        y = MARGIN;
      }
      doc
        .font(regular)
        .fontSize(9)
        .fillColor(GRAY)
        .text(
          `Dieses Angebot ist freibleibend${beleg.gueltigBis ? ` und gültig bis zum ${fmtDatum(beleg.gueltigBis)}` : ""}. Alle Preise verstehen sich zuzüglich der ausgewiesenen Umsatzsteuer. Bei Auftragserteilung erhalten Sie von uns eine gesonderte Rechnung.`,
          MARGIN,
          y,
          { width: CONTENT_W },
        );
      y += 30;
    }

    // ── Lieferadresse (Bestellung) ──────────────────────────────────────────
    if (beleg.art === "bestellung") {
      if (y + 100 > unterkante) {
        doc.addPage();
        y = MARGIN;
      }
      doc.font(bold).fontSize(9).fillColor(DARK).text("Lieferadresse", MARGIN, y);
      y += 14;
      doc
        .font(regular)
        .fontSize(9)
        .fillColor(GRAY)
        .text(
          `Bitte liefern Sie die Ware unter Angabe der Bestellnummer ${beleg.nummer} an:`,
          MARGIN,
          y,
          { width: CONTENT_W },
        );
      y += 14;
      doc.font(regular).fontSize(9).fillColor(DARK);
      doc.text(beleg.firma.name, MARGIN, y);
      y += 13;
      doc.text(beleg.firma.strasse, MARGIN, y);
      y += 13;
      doc.text(`${beleg.firma.plz} ${beleg.firma.ort}`, MARGIN, y);
      y += 20;
    }

    // ── Zahlungs- / Bankblock ───────────────────────────────────────────────
    if (beleg.bank) {
      if (y + 90 > unterkante) {
        doc.addPage();
        y = MARGIN;
      }
      if (beleg.art === "rechnung") {
        doc.font(bold).fontSize(9).fillColor(DARK).text("Zahlungsanweisungen", MARGIN, y);
        y += 14;
        doc.font(regular).fontSize(9).fillColor(GRAY);
        doc.text(
          `Bitte überweisen Sie den zu zahlenden Betrag${beleg.faellig ? ` bis zum ${fmtDatum(beleg.faellig)}` : ""} auf das folgende Konto und geben Sie als Verwendungszweck die Rechnungsnummer ${beleg.nummer} an.`,
          MARGIN,
          y,
          { width: CONTENT_W },
        );
        y += 26;
      } else if (beleg.art === "gutschrift") {
        doc.font(bold).fontSize(9).fillColor(DARK).text("Erstattung", MARGIN, y);
        y += 14;
        doc
          .font(regular)
          .fontSize(9)
          .fillColor(GRAY)
          .text(
            `Der Gutschriftbetrag wird auf das uns bekannte Konto erstattet.`,
            MARGIN,
            y,
            { width: CONTENT_W },
          );
        y += 26;
      }
      doc.font(regular).fontSize(9).fillColor(DARK);
      doc.text(
        `Bank: ${beleg.bank.bankName}   Kontoinhaber: ${beleg.bank.kontoinhaber}`,
        MARGIN,
        y,
      );
      y += 13;
      doc.text(
        `IBAN: ${fmtIban(beleg.bank.iban)}${beleg.bank.bic ? `   BIC: ${beleg.bank.bic}` : ""}`,
        MARGIN,
        y,
      );
      y += 20;
    }

    // ── Grußtext ────────────────────────────────────────────────────────────
    if (beleg.firma.fussText) {
      if (y + 40 > unterkante) {
        doc.addPage();
        y = MARGIN;
      }
      doc.font(regular).fontSize(9).fillColor(GRAY).text(beleg.firma.fussText, MARGIN, y, {
        width: CONTENT_W,
      });
    }

    // ── Fußzeile auf allen Seiten ───────────────────────────────────────────
    const range = doc.bufferedPageRange();
    const belegTitel = `${BELEG_TITEL[beleg.art]} ${beleg.nummer}`;
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      // Fußzeile liegt unterhalb des normalen Textbereichs — Auto-Umbruch aus
      (doc.page as unknown as { margins: { bottom: number } }).margins.bottom = 0;
      const fy = 800;
      doc
        .moveTo(MARGIN, fy - 8)
        .lineTo(PAGE_W - MARGIN, fy - 8)
        .lineWidth(0.4)
        .strokeColor(LINE)
        .stroke();
      doc
        .font(regular)
        .fontSize(8)
        .fillColor(LIGHT)
        .text(
          `${beleg.firma.name} · ${beleg.firma.strasse} · ${beleg.firma.plz} ${beleg.firma.ort}`,
          MARGIN,
          fy,
          { width: 340 },
        );
      doc.text(
        `Seite ${i + 1} von ${range.count} · ${belegTitel}`,
        MARGIN + 340,
        fy,
        { width: CONTENT_W - 340, align: "right" },
      );
    }

    doc.end();
  });
}

// ── Mahnung / Zahlungserinnerung (Brief-Layout, gleiche Identität) ───────────
export const MAHN_STUFEN: Record<number, string> = {
  1: "Zahlungserinnerung",
  2: "1. Mahnung",
  3: "2. Mahnung",
};

export interface MahnungsDaten {
  stufe: number;
  datum: string;
  zahlungsfrist: string;
  offenCent: number;
  bruttoCent: number;
  bezahltCent: number;
  rechnungNummer: string;
  rechnungDatum: string;
  firma: PdfBeleg["firma"];
  bank?: PdfBeleg["bank"];
  kunde: PdfBeleg["kunde"];
}

export function renderMahnungPdf(d: MahnungsDaten): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: MARGIN, bottom: 70, left: MARGIN, right: MARGIN },
      bufferPages: true,
      font: FONT_REGULAR(),
      info: {
        Title: `${MAHN_STUFEN[d.stufe] ?? "Mahnung"} zu Rechnung ${d.rechnungNummer}`,
        Author: d.firma.name,
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const regular = FONT_REGULAR();
    const bold = FONT_BOLD();

    // ── Kopf ──────────────────────────────────────────────────────────────
    doc.font(bold).fontSize(20).fillColor(DARK).text(d.firma.name, MARGIN, MARGIN);
    doc.font(regular).fontSize(9).fillColor(GRAY)
      .text(`${d.firma.strasse} · ${d.firma.plz} ${d.firma.ort}`, MARGIN, MARGIN + 26);
    const kontakt = [
      d.firma.handelsregister ? `Handelsregister: ${d.firma.handelsregister}` : null,
      d.firma.steuernummer ? `Steuernummer: ${d.firma.steuernummer}` : null,
      d.firma.email ? `E-Mail: ${d.firma.email}` : null,
      d.firma.telefon ? `Telefon: ${d.firma.telefon}` : null,
      d.firma.webseite ? `Webseite: ${d.firma.webseite}` : null,
    ].filter(Boolean) as string[];
    kontakt.forEach((zeile, i) => {
      doc.font(regular).fontSize(8).fillColor(GRAY).text(zeile, MARGIN, MARGIN + 6 + i * 11, {
        width: CONTENT_W, align: "right",
      });
    });
    let y = MARGIN + 78;
    doc.moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y).lineWidth(0.5).strokeColor(LIGHT).stroke();
    y += 24;

    // ── Empfänger + Titel/Datum ───────────────────────────────────────────
    doc.font(regular).fontSize(8).fillColor(LIGHT).text("Empfänger", MARGIN, y);
    doc.font(regular).fontSize(9).fillColor(GRAY).text("Datum:", MARGIN + 280, y);
    doc.font(bold).fontSize(9).fillColor(DARK).text(fmtDatum(d.datum), MARGIN + 400, y, {
      width: CONTENT_W - 350, align: "right",
    });
    y += 14;
    doc.font(bold).fontSize(10).fillColor(DARK).text(d.kunde.name, MARGIN, y);
    y += 13;
    doc.font(regular).fontSize(9).fillColor(DARK);
    if (d.kunde.zusatz) { doc.text(d.kunde.zusatz, MARGIN, y); y += 13; }
    doc.text(d.kunde.strasse, MARGIN, y); y += 13;
    doc.text(`${d.kunde.plz} ${d.kunde.ort}`, MARGIN, y); y += 13;
    doc.text(d.kunde.land, MARGIN, y); y += 28;

    // ── Betreff ───────────────────────────────────────────────────────────
    const titel = MAHN_STUFEN[d.stufe] ?? "Mahnung";
    doc.font(bold).fontSize(13).fillColor(DARK)
      .text(`${titel} zu Rechnung ${d.rechnungNummer}`, MARGIN, y);
    y += 24;

    // ── Brieftext ─────────────────────────────────────────────────────────
    doc.font(regular).fontSize(9.5).fillColor(DARK);
    const text1 = d.stufe === 1
      ? `bei der Durchsicht unserer Buchhaltung ist uns aufgefallen, dass die oben genannte Rechnung vom ${fmtDatum(d.rechnungDatum)} noch nicht beglichen wurde. Möglicherweise haben Sie die Zahlung bereits veranlasst — in diesem Fall betrachten Sie dieses Schreiben bitte als gegenstandslos.`
      : `trotz ${d.stufe === 2 ? "Zahlungserinnerung" : "bisheriger Mahnungen"} ist die oben genannte Rechnung vom ${fmtDatum(d.rechnungDatum)} weiterhin nicht beglichen.`;
    doc.text("Sehr geehrte Damen und Herren,", MARGIN, y); y += 16;
    doc.text(text1, MARGIN, y, { width: CONTENT_W, align: "left" });
    y = doc.y + 12;

    // ── Betragsübersicht ──────────────────────────────────────────────────
    const boxY = y;
    doc.rect(MARGIN, boxY, CONTENT_W, 58).fillColor("#f7f7f7").fill();
    const spalten: [string, string][] = [
      ["Rechnungsbetrag", fmtGeld(d.bruttoCent)],
      ["Bereits bezahlt", fmtGeld(d.bezahltCent)],
      ["Offener Betrag", fmtGeld(d.offenCent)],
    ];
    spalten.forEach(([label, wert], i) => {
      const x = MARGIN + 20 + i * ((CONTENT_W - 40) / 3);
      doc.font(regular).fontSize(8).fillColor(GRAY).text(label, x, boxY + 12);
      doc.font(i === 2 ? bold : regular).fontSize(13).fillColor(DARK)
        .text(`${wert} €`, x, boxY + 26);
    });
    y = boxY + 76;

    // ── Zahlungsaufforderung ──────────────────────────────────────────────
    doc.font(regular).fontSize(9.5).fillColor(DARK).text(
      `Wir bitten Sie, den offenen Betrag von ${fmtGeld(d.offenCent)} € bis spätestens ${fmtDatum(d.zahlungsfrist)} unter Angabe der Rechnungsnummer ${d.rechnungNummer} zu überweisen.`,
      MARGIN, y, { width: CONTENT_W },
    );
    y = doc.y + 16;

    if (d.bank) {
      doc.font(bold).fontSize(9).fillColor(DARK).text("Bankverbindung", MARGIN, y); y += 14;
      doc.font(regular).fontSize(9).fillColor(DARK);
      doc.text(`Bank: ${d.bank.bankName}   Kontoinhaber: ${d.bank.kontoinhaber}`, MARGIN, y); y += 13;
      doc.text(`IBAN: ${fmtIban(d.bank.iban)}${d.bank.bic ? `   BIC: ${d.bank.bic}` : ""}`, MARGIN, y); y += 20;
    }

    if (d.firma.fussText) {
      y += 10;
      doc.font(regular).fontSize(9).fillColor(GRAY).text(d.firma.fussText, MARGIN, y, { width: CONTENT_W });
    }

    // ── Fußzeile ──────────────────────────────────────────────────────────
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      (doc.page as unknown as { margins: { bottom: number } }).margins.bottom = 0;
      doc.moveTo(MARGIN, 790).lineTo(PAGE_W - MARGIN, 790).lineWidth(0.5).strokeColor("#dddddd").stroke();
      doc.font(regular).fontSize(7.5).fillColor(LIGHT)
        .text(`${d.firma.name} · ${d.firma.strasse} · ${d.firma.plz} ${d.firma.ort}`, MARGIN, 800);
      doc.text(
        `Seite ${i + 1} von ${range.count} · ${titel} · Rechnung ${d.rechnungNummer}`,
        MARGIN, 800, { width: CONTENT_W, align: "right" },
      );
    }

    doc.end();
  });
}
