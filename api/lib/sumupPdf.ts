// SumUp-Rechnungs-PDF-Parser: extrahiert komplette Belege aus den von SumUp
// erzeugten Rechnungs-PDFs (Text-PDF, kein Scan). Läuft lokal per pdftotext.
import { execFile } from "child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";

const execFileP = promisify(execFile);

export interface SumUpPosition {
  bezeichnung: string;
  menge: number;
  einheit: string;
  einzelpreis: number;
  ustSatz: number;
  betrag: number;
}

export interface SumUpRechnung {
  nummer: string;
  datum: string | null; // ISO
  faellig: string | null; // ISO
  kunde: string;
  kundeStrasse: string | null;
  kundePlz: string | null;
  kundeOrt: string | null;
  kundeLand: string | null;
  positionen: SumUpPosition[];
  netto: number;
  ust: number;
  brutto: number;
  bezahlt: number;
  storniert: boolean;
  warnung: string | null;
}

function zahl(s: string): number | null {
  const t = s.trim().replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function datumZuIso(s: string): string | null {
  const m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (!m) return null;
  const [, t, mo, j] = m;
  return `${j}-${mo.padStart(2, "0")}-${t.padStart(2, "0")}`;
}

async function pdfText(puffer: Buffer): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "sumup-"));
  try {
    const pdf = join(dir, "rechnung.pdf");
    writeFileSync(pdf, puffer);
    const txt = join(dir, "rechnung.txt");
    try {
      await execFileP("pdftotext", ["-layout", pdf, txt], { timeout: 30000 });
    } catch {
      throw new Error("pdftotext fehlgeschlagen (poppler-utils fehlt im Image?).");
    }
    return readFileSync(txt, "utf8");
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}

export function istSumUpPdf(text: string): boolean {
  return /SUMUP LIMITED|invoice\.sumup\.com|Seite \d+ von \d+ von Rechnung/i.test(text);
}

export function parseSumUpPdf(text: string): SumUpRechnung {
  const zeilen = text.split("\n");

  // Nummer + Empfänger (stehen in einer Zeile, rechte Spalte: Nummer)
  let nummer = "";
  let kunde = "";
  const empfaengerM = text.match(/Empfänger:\s*(.+?)\s{3,}Rechnung:\s*(\S+)/);
  if (empfaengerM) {
    kunde = empfaengerM[1].trim();
    nummer = empfaengerM[2].trim();
  } else {
    const nrM = text.match(/Rechnung:\s*(\d{4}-\d{3,})/);
    if (nrM) nummer = nrM[1];
    const emM = text.match(/Empfänger:\s*(.+)/);
    if (emM) kunde = emM[1].trim();
  }

  // Adresse: Zeilen nach dem Empfänger, linke Spalte bis "Deutschland"
  let kundeStrasse: string | null = null;
  let kundePlz: string | null = null;
  let kundeOrt: string | null = null;
  let kundeLand: string | null = null;
  const startIdx = zeilen.findIndex((z) => /Empfänger:/.test(z));
  const teile: string[] = [];
  for (let i = startIdx + 1; i < Math.min(startIdx + 6, zeilen.length); i++) {
    const z = zeilen[i].trim();
    if (!z) break;
    if (/^Deutschland/.test(z)) {
      kundeLand = "Deutschland";
      break;
    }
    if (/Rechnungsdatum|Fälligkeitsdatum/.test(z)) {
      const links = z.split(/\s{3,}/)[0]?.trim();
      if (links) teile.push(links);
      continue;
    }
    teile.push(z.split(/\s{3,}/)[0]?.trim() ?? "");
  }
  for (const t of teile.filter(Boolean)) {
    const plzM = t.match(/^(\d{4,5})\s+(.+)$/);
    if (plzM) {
      kundePlz = plzM[1];
      kundeOrt = plzM[2].trim();
    } else if (!kundeStrasse) {
      kundeStrasse = t;
    }
  }

  // Daten
  const datumM = text.match(/Rechnungsdatum:\s*(\d{1,2}\.\d{1,2}\.\d{4})/);
  const faelligM = text.match(/Fälligkeitsdatum:\s*(\d{1,2}\.\d{1,2}\.\d{4})/);
  const datum = datumM ? datumZuIso(datumM[1]) : null;
  const faellig = faelligM ? datumZuIso(faelligM[1]) : null;

  // Positionen: Block zwischen Tabellenkopf und Zwischensumme
  const kopfIdx = zeilen.findIndex((z) => /Beschreibung/.test(z) && /Betrag/.test(z));
  const summeIdx = zeilen.findIndex((z) => /Zwischensumme ohne USt/.test(z));
  const positionen: SumUpPosition[] = [];
  if (kopfIdx >= 0 && summeIdx > kopfIdx) {
    const posRe = /^(\S.*?)\s{2,}(\d+)\s+([A-Za-zÄÖÜäöüß]+)\s+([\d.]+,\d{2})\s+(\d+)%\s+([\d.]+,\d{2})\s*$/;
    for (let i = kopfIdx + 1; i < summeIdx; i++) {
      const z = zeilen[i].replace(/\s+$/, "");
      if (!z.trim()) continue;
      const m = z.match(posRe);
      if (m) {
        positionen.push({
          bezeichnung: m[1].trim(),
          menge: parseInt(m[2], 10),
          einheit: m[3],
          einzelpreis: zahl(m[4]) ?? 0,
          ustSatz: parseInt(m[5], 10),
          betrag: zahl(m[6]) ?? 0,
        });
      } else if (positionen.length > 0) {
        // Zusatzzeile: Beschreibung der vorherigen Position ergänzen
        const zusaetzlich = z.trim();
        if (zusaetzlich && !/^\s*$/.test(zusaetzlich)) {
          const letzte = positionen[positionen.length - 1];
          letzte.bezeichnung += "\n" + zusaetzlich;
        }
      }
    }
  }

  // Summen
  const greife = (re: RegExp): number => {
    const m = text.match(re);
    return m ? (zahl(m[1]) ?? 0) : 0;
  };
  const netto = greife(/Zwischensumme ohne USt\.\s+([\d.]+,\d{2})/);
  const ust = greife(/USt\. \d+% von [\d.]+,\d{2}\s+([\d.]+,\d{2})/);
  const brutto = greife(/Gesamt EUR\s+([\d.]+,\d{2})/);
  const bezahlt = greife(/Bezahlter Betrag\s+([\d.]+,\d{2})/);
  const storniert = /storniert/i.test(text);

  // Plausi-Checks
  let warnung: string | null = null;
  if (!nummer) warnung = "Rechnungsnummer nicht erkannt";
  else if (!kunde) warnung = "Empfänger nicht erkannt";
  else if (!datum) warnung = "Rechnungsdatum nicht erkannt";
  else if (positionen.length === 0) warnung = "Keine Positionen erkannt";
  else if (Math.abs(netto + ust - brutto) > 0.02) warnung = `Summen passen nicht (Netto ${netto} + USt ${ust} ≠ Brutto ${brutto})`;

  return {
    nummer,
    datum,
    faellig,
    kunde,
    kundeStrasse,
    kundePlz,
    kundeOrt,
    kundeLand,
    positionen,
    netto,
    ust,
    brutto,
    bezahlt,
    storniert,
    warnung,
  };
}

/** Schneller Merkmal-Check (fuer Routing-Entscheidungen, z. B. Magic Import). */
export async function erkenneSumUpMerkmale(puffer: Buffer): Promise<boolean> {
  try {
    const text = await pdfText(puffer);
    return istSumUpPdf(text);
  } catch {
    return false;
  }
}

export async function analysiereSumUpPdfDatei(puffer: Buffer): Promise<SumUpRechnung & { istSumUp: boolean }> {
  const text = await pdfText(puffer);
  if (!istSumUpPdf(text)) {
    throw new Error("Keine SumUp-Rechnung erkannt (keine SumUp-Merkmale im PDF-Text).");
  }
  return { ...parseSumUpPdf(text), istSumUp: true };
}
