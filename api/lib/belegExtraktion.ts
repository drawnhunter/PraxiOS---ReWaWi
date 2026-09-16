// ── Beleg-Extraktion: OCR-Text → strukturierte Felder (regelbasiert, testbar) ─
// Kein externes KI-Raten: deutsche Rechnungsmuster (Betrag, Datum, MwSt, IBAN,
// Rechnungsnummer, Lieferant). Jedes Feld bekommt eine Konfidenz 0–1.

export interface BelegExtraktion {
  lieferant?: { wert: string; konfidenz: number };
  datum?: { wert: string; konfidenz: number }; // JJJJ-MM-TT
  brutto?: { wert: string; konfidenz: number }; // "123,45"
  mwst?: { wert: string; konfidenz: number };
  nummer?: { wert: string; konfidenz: number };
  iban?: { wert: string; konfidenz: number };
}

const BETRAG = /(\d{1,3}(?:\.\d{3})*,\d{2})/;

function betragAus(s: string): string | null {
  const m = s.match(BETRAG);
  return m ? m[1] : null;
}

function datumNormalisieren(d: string): string | null {
  // TT.MM.JJJJ / TT.MM.JJ / JJJJ-MM-TT
  let m = d.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = d.match(/(\d{1,2})\.(\d{1,2})\.(\d{2})\b/);
  if (m) return `20${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = d.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[0];
  return null;
}

/** Extrahiert strukturierte Belegdaten aus OCR-/PDF-Text. */
export function extrahiereBelegFelder(text: string): BelegExtraktion {
  const zeilen = text.split(/\r?\n/).map((z) => z.trim()).filter(Boolean);
  const out: BelegExtraktion = {};

  // ── Lieferant: erste nicht-leere Zeile, die keine typische Kopf-Floskel ist ──
  const floskel = /^(rechnung|invoice|gutschrift|lieferschein|seite|datum|nr\.?|kunden)/i;
  const erste = zeilen.find((z) => z.length >= 3 && z.length <= 80 && !floskel.test(z) && !/^\d/.test(z));
  if (erste) out.lieferant = { wert: erste, konfidenz: 0.6 };

  // ── Rechnungsnummer ──
  const nrMuster = [
    { r: /rechnungs?-?\s*(?:nr\.?|nummer)\s*[:.]?\s*([A-ZÄÖÜ0-9][\w\-\/]{2,30})/i, k: 0.95 },
    { r: /(?:invoice|beleg)\s*(?:nr\.?|no\.?|number)\s*[:.]?\s*([A-ZÄÖÜ0-9][\w\-\/]{2,30})/i, k: 0.85 },
    { r: /rechnung\s+([A-ZÄÖÜ]{0,3}\d{3,}[\w\-\/]*)/i, k: 0.6 },
  ];
  for (const { r, k } of nrMuster) {
    const m = text.match(r);
    if (m) { out.nummer = { wert: m[1], konfidenz: k }; break; }
  }

  // ── Datum: Rechnungsdatum bevorzugt, sonst erstes Datum im Dokument ──
  const datMuster = [
    { r: /rechnungsdatum\s*[:.]?\s*(\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}|\d{4}-\d{2}-\d{2})/i, k: 0.95 },
    { r: /(?:ausgestellt|datum)\s*[:.,]?\s*(\d{1,2}\.\d{1,2}\.\d{2,4})/i, k: 0.8 },
  ];
  for (const { r, k } of datMuster) {
    const m = text.match(r);
    const d = m ? datumNormalisieren(m[1]) : null;
    if (d) { out.datum = { wert: d, konfidenz: k }; break; }
  }
  if (!out.datum) {
    const m = text.match(/\b(\d{1,2}\.\d{1,2}\.\d{4})\b/);
    const d = m ? datumNormalisieren(m[1]) : null;
    if (d) out.datum = { wert: d, konfidenz: 0.5 };
  }

  // ── Brutto: Gesamt-/Endbetrag bevorzugt ──
  const bruttoMuster = [
    { r: /(?:gesamt|end)betrag(?:\s*(?:brutto|inkl\.?\s*mwst\.?))?\s*[:.]?\s*(?:EUR|€)?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i, k: 0.95 },
    { r: /brutto(?:betrag|summe)?\s*[:.]?\s*(?:EUR|€)?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i, k: 0.9 },
    { r: /(?:zu\s+zahlen|zahlbar|gesamt)\s*[:.]?\s*(?:EUR|€)?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i, k: 0.8 },
  ];
  for (const { r, k } of bruttoMuster) {
    const m = text.match(r);
    if (m) { out.brutto = { wert: m[1], konfidenz: k }; break; }
  }
  if (!out.brutto) {
    // Fallback: größter Geldbetrag im Text (Brutto ist meist der größte)
    const alle = [...text.matchAll(/(\d{1,3}(?:\.\d{3})*,\d{2})\s*(?:EUR|€)/gi)].map((m) => betragAus(m[1]));
    const valide = alle.filter((b): b is string => Boolean(b));
    if (valide.length) {
      const groesste = valide.reduce((a, b) =>
        parseFloat(b.replace(/\./g, "").replace(",", ".")) > parseFloat(a.replace(/\./g, "").replace(",", ".")) ? b : a);
      out.brutto = { wert: groesste, konfidenz: 0.45 };
    }
  }

  // ── MwSt-Betrag: bevorzugt Zeilen mit Steuersatz (19 %), nie „inkl. MwSt"-Zeilen ──
  const mwstZeilen = text.split(/\r?\n/).filter((z) => /(mwst|ust|umsatzsteuer)/i.test(z) && !/inkl|enthalten|gesamt/i.test(z));
  for (const z of mwstZeilen) {
    const m = z.match(/(?:mwst|ust|umsatzsteuer)\.?\s*\d{1,2}\s*%\s*[:.]?\s*(?:EUR|€)?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i)
      ?? z.match(/(?:mwst|ust|umsatzsteuer)\.?[^\d]*(?:EUR|€)?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i);
    if (m) { out.mwst = { wert: m[1], konfidenz: /%/.test(z) ? 0.9 : 0.7 }; break; }
  }

  // ── IBAN ──
  const ibanM = text.match(/\b(DE\d{2}(?:\s?\d{4}){2}(?:\s?\d{4}){2}(?:\s?\d{2})?)\b/i);
  if (ibanM) out.iban = { wert: ibanM[1].replace(/\s/g, "").toUpperCase(), konfidenz: 0.95 };

  return out;
}
