// ── DATEV XML-Schnittstelle online: document.xml (Verwaltungsdatendatei) ────
// Aufbau verifiziert gegen die oeffentliche Spezifikation (developer.datev.de,
// Variante 1: Buchungsstapel-CSV + ZIP mit Belegen):
//   <archive><header><date/><description/></header>
//   <content><document guid processID type><extension xsi:type="File" name/></document></content></archive>
// Die guid steht zusaetzlich im Stapel in der Spalte Beleglink als BEDI "<guid>"
// — so ordnen DATEV ReWe + Unternehmen online Beleg und Buchung automatisch zu.
import { createHash } from "node:crypto";

export interface BelegEintrag {
  guid: string;
  dateiname: string;
  /** 1 = Rechnungseingang (Lieferant), 2 = Rechnungsausgang (Kunde) */
  typ: 1 | 2;
}

/** Stabile GUID je Beleg (Re-Exporte erzeugen dieselbe Verknuepfung). */
export function belegGuid(schluessel: string): string {
  const h = createHash("sha256").update(`rewawi-beleg:${schluessel}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Baut die document.xml fuer das Beleg-ZIP (DATEV Belegtransfer). */
export function baueDocumentXml(eintraege: BelegEintrag[], beschreibung: string): string {
  const jetzt = new Date().toISOString().slice(0, 19);
  const dokumente = eintraege
    .map(
      (e) =>
        `    <document guid="${e.guid}" processID="1" type="${e.typ}">\n` +
        `      <extension xsi:type="File" name="${esc(e.dateiname)}"/>\n` +
        `    </document>`,
    )
    .join("\n");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<archive xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n` +
    `  <header>\n` +
    `    <date>${jetzt}</date>\n` +
    `    <description>${esc(beschreibung)}</description>\n` +
    `  </header>\n` +
    `  <content>\n${dokumente}\n  </content>\n</archive>\n`
  );
}
