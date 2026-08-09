// OCR-Dienst: lokale Erkennung eingescannter Belege.
// Läuft komplett auf dem eigenen Server (tesseract + pdftoppm im Docker-Image)
// — keine Belegdaten verlassen das System.
import { execFile } from "child_process";
import { mkdtempSync, writeFileSync, readdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";

const execFileP = promisify(execFile);

async function tesseractVorhanden(): Promise<string[]> {
  try {
    const { stdout } = await execFileP("tesseract", ["--list-langs"], { timeout: 10000 });
    return stdout.split("\n").map((z) => z.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

async function sprache(): Promise<string> {
  const sprachen = await tesseractVorhanden();
  if (sprachen.includes("deu")) return "deu";
  if (sprachen.includes("eng")) return "eng";
  return "osd";
}

/** OCR eines Belegs (PDF via pdftoppm, Bilder direkt). Gibt den Rohtext zurück. */
export async function ocrBeleg(mime: string, puffer: Buffer): Promise<string> {
  const verfuegbare = await tesseractVorhanden();
  if (verfuegbare.length === 0) {
    throw new Error(
      "OCR ist auf diesem Server nicht installiert (Paket tesseract-ocr fehlt im Image).",
    );
  }
  const lang = await sprache();
  const dir = mkdtempSync(join(tmpdir(), "ocr-"));
  try {
    let bilder: string[] = [];
    if (mime === "application/pdf") {
      const pdf = join(dir, "beleg.pdf");
      writeFileSync(pdf, puffer);
      try {
        await execFileP(
          "pdftoppm",
          ["-png", "-r", "200", "-f", "1", "-l", "3", pdf, join(dir, "seite")],
          { timeout: 60000 },
        );
        bilder = readdirSync(dir)
          .filter((d) => d.startsWith("seite") && d.endsWith(".png"))
          .sort()
          .map((d) => join(dir, d));
      } catch {
        throw new Error("PDF konnte nicht gerendert werden (pdftoppm fehlt?).");
      }
    } else if (mime.startsWith("image/")) {
      const bild = join(dir, mime.includes("png") ? "beleg.png" : "beleg.jpg");
      writeFileSync(bild, puffer);
      bilder = [bild];
    } else {
      throw new Error("OCR unterstützt nur PDF-Scans und Bilder (JPG/PNG).");
    }
    if (bilder.length === 0) throw new Error("Keine Seiten für die Erkennung gefunden.");

    const teile: string[] = [];
    for (const bild of bilder) {
      try {
        const { stdout } = await execFileP(
          "tesseract",
          [bild, "stdout", "-l", lang, "--psm", "4"],
          { timeout: 90000, maxBuffer: 4 * 1024 * 1024 },
        );
        teile.push(stdout);
      } catch {
        // einzelne Seite ohne Text ist ok (z. B. leere Rückseite)
      }
    }
    return teile.join("\n\n");
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* aufräumen best effort */
    }
  }
}

// ── Feld-Extraktion aus OCR-Text (Heuristiken, deutscher Geschäftsbrief) ────

export type Konfidenz = "hoch" | "mittel" | "niedrig";
export interface OcrVorschlag {
  wert: string | null;
  konfidenz: Konfidenz;
}
export interface OcrFelder {
  betrag: OcrVorschlag;
  iban: OcrVorschlag;
  rechnungsnummer: OcrVorschlag;
  rechnungsdatum: OcrVorschlag;
  faellig: OcrVorschlag;
  absender: OcrVorschlag;
}

const ZAHL_RE = /(\d{1,3}(?:[.\s]?\d{3})*,\d{2})/g;

function zuZahl(s: string): number {
  return parseFloat(s.replace(/[.\s]/g, "").replace(",", "."));
}

function zuIso(t: string, m: string, j: string): string | null {
  let tag = parseInt(t, 10);
  let monat = parseInt(m, 10);
  let jahr = parseInt(j.length === 2 ? "20" + j : j, 10);
  if (monat < 1 || monat > 12 || tag < 1 || tag > 31 || jahr < 1990 || jahr > 2100) return null;
  return `${jahr}-${String(monat).padStart(2, "0")}-${String(tag).padStart(2, "0")}`;
}

const DATUM_RE = /(\d{1,2})\.(\d{1,2})\.(\d{2,4})/g;

function findeDaten(text: string): string[] {
  const fund: string[] = [];
  for (const m of text.matchAll(DATUM_RE)) {
    const iso = zuIso(m[1], m[2], m[3]);
    if (iso) fund.push(iso);
  }
  return fund;
}

function groessterBetrag(zeilen: string[]): number | null {
  let max: number | null = null;
  for (const z of zeilen) {
    for (const m of z.matchAll(ZAHL_RE)) {
      const w = zuZahl(m[1]);
      if (w > 0 && w < 10000000 && (max === null || w > max)) max = w;
    }
  }
  return max;
}

export function extrahiereFelder(text: string): OcrFelder {
  const zeilen = text.split("\n").map((z) => z.trim()).filter(Boolean);
  const lower = text.toLowerCase();

  // IBAN
  let iban: OcrVorschlag = { wert: null, konfidenz: "niedrig" };
  const ibanM = text.replace(/\s/g, "").match(/DE\d{20}/);
  if (ibanM) iban = { wert: ibanM[0], konfidenz: "hoch" };

  // Betrag: erst Summen-Zeilen, sonst größter Betrag im Dokument
  const summenZeilen = zeilen.filter((z) =>
    /(gesamt|summe|brutto|rechnungsbetrag|endbetrag|zu zahlen|zahlbetrag|fällig|total)/i.test(z),
  );
  let betragWert = groessterBetrag(summenZeilen);
  let betragKonf: Konfidenz = "hoch";
  if (betragWert === null) {
    betragWert = groessterBetrag(zeilen);
    betragKonf = betragWert === null ? "niedrig" : "mittel";
  }

  // Rechnungsnummer
  let rechnungsnummer: OcrVorschlag = { wert: null, konfidenz: "niedrig" };
  const nrM =
    text.match(/rechnungs?-?\s*(?:nr|nummer|no|#)\.?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\/]{2,})/i) ||
    text.match(/rechnung\s+([A-Z]{1,4}[-\/]?\d{3,}[A-Z0-9\-\/]*)/i);
  if (nrM) rechnungsnummer = { wert: nrM[1].replace(/[.,;:]$/, ""), konfidenz: "hoch" };

  // Rechnungsdatum: Datum nahe "Rechnungsdatum"/"vom", sonst erstes Datum
  let rechnungsdatum: OcrVorschlag = { wert: null, konfidenz: "niedrig" };
  const datumKontextM = text.match(/(?:rechnungsdatum|ausstellungsdatum|rechnung vom|datum)[^\d]{0,20}(\d{1,2})\.(\d{1,2})\.(\d{2,4})/i);
  if (datumKontextM) {
    const iso = zuIso(datumKontextM[1], datumKontextM[2], datumKontextM[3]);
    if (iso) rechnungsdatum = { wert: iso, konfidenz: "hoch" };
  }
  if (!rechnungsdatum.wert) {
    const alle = findeDaten(text);
    if (alle.length > 0) rechnungsdatum = { wert: alle[0], konfidenz: "mittel" };
  }

  // Fälligkeit: "zahlbar bis", "Zahlungsziel", "in X Tagen"
  let faellig: OcrVorschlag = { wert: null, konfidenz: "niedrig" };
  const bisM = text.match(/(?:zahlbar|zahlung|zahlungsziel|fällig)\s*(?:bis(?: zum)?|am)?\s*[:\-]?\s*(?:spätestens\s*)?(?:den\s+)?(\d{1,2})\.(\d{1,2})\.(\d{2,4})/i);
  if (bisM) {
    const iso = zuIso(bisM[1], bisM[2], bisM[3]);
    if (iso) faellig = { wert: iso, konfidenz: "hoch" };
  }
  if (!faellig.wert) {
    const tageM = lower.match(/(?:zahlbar|zahlung|zahlungsziel)\s*(?:innerhalb(?: von)?|in)\s*(\d{1,3})\s*tagen/i);
    if (tageM && rechnungsdatum.wert) {
      const d = new Date(rechnungsdatum.wert + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + parseInt(tageM[1], 10));
      faellig = { wert: d.toISOString().slice(0, 10), konfidenz: "mittel" };
    }
  }

  // Absender: erste Zeile, die wie ein Firmenname aussieht (kein Datum, keine Zahl)
  let absender: OcrVorschlag = { wert: null, konfidenz: "niedrig" };
  for (const z of zeilen.slice(0, 12)) {
    if (z.length >= 4 && z.length <= 70 && !/\d{3,}/.test(z) && !DATUM_RE.test(z) && !/straße|str\.|plz|\d{5}/i.test(z)) {
      absender = { wert: z.replace(/[|_]/g, " ").trim(), konfidenz: "niedrig" };
      break;
    }
  }

  return {
    betrag: { wert: betragWert === null ? null : betragWert.toFixed(2), konfidenz: betragKonf },
    iban,
    rechnungsnummer,
    rechnungsdatum,
    faellig,
    absender,
  };
}
