// ── NEM-Word-Import: .docx (Tabelle oder Freitext) → strukturierte Positionen ─
// Unterstützt zwei Formate:
//  1) Einheitliche Vorlage (Tabelle: Produkt | Menge | Einzelpreis | Summe)
//  2) Alte Freitext-Listen ("Pro Mucosa 73,95€", "Pro PEA 800 28,43€ 2x 56,86€")

import { unzipSync, strFromU8 } from "fflate";

export interface NemPosition {
  bezeichnung: string;
  menge: number;
  einzelpreis: number | null;
}

export interface NemDokument {
  name: string | null;
  geburtsdatum: string | null;
  datum: string | null;
  phase: string | null;
  positionen: NemPosition[];
  format: "tabelle" | "freitext";
}

function deZahl(s: string | undefined): number | null {
  if (!s) return null;
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** docx (zip) → reiner Text je Absatz sowie Tabellenzeilen. */
export function docxAuspacken(puffer: Buffer): { absaetze: string[]; tabellen: string[][][] } {
  const dateien = unzipSync(new Uint8Array(puffer));
  const docXml = dateien["word/document.xml"];
  if (!docXml) throw new Error("Keine gültige Word-Datei (word/document.xml fehlt).");
  const xml = strFromU8(docXml);

  const absaetze: string[] = [];
  const tabellen: string[][][] = [];

  // Tabellen zuerst: <w:tbl> → <w:tr> → <w:tc> → Texte
  const tblRegex = /<w:tbl>[\s\S]*?<\/w:tbl>/g;
  const tabellenXml = xml.match(tblRegex) ?? [];
  for (const tXml of tabellenXml) {
    const zeilen: string[][] = [];
    const trRegex = /<w:tr[ >][\s\S]*?<\/w:tr>/g;
    for (const tr of tXml.match(trRegex) ?? []) {
      const zellen: string[] = [];
      const tcRegex = /<w:tc>[\s\S]*?<\/w:tc>/g;
      for (const tc of tr.match(tcRegex) ?? []) {
        const texte = [...tc.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]);
        zellen.push(texte.join("").trim());
      }
      if (zellen.some(Boolean)) zeilen.push(zellen);
    }
    if (zeilen.length > 0) tabellen.push(zeilen);
  }

  // Absätze außerhalb von Tabellen: Tabelle(n) aus XML entfernen, dann <w:p> lesen
  const ohneTabellen = xml.replace(tblRegex, "");
  const pRegex = /<w:p[ >][\s\S]*?<\/w:p>/g;
  for (const pXml of ohneTabellen.match(pRegex) ?? []) {
    const texte = [...pXml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]);
    const zeile = texte.join("").trim();
    if (zeile) absaetze.push(zeile);
  }

  return { absaetze, tabellen };
}

function metaLesen(absaetze: string[]): Pick<NemDokument, "name" | "geburtsdatum" | "datum" | "phase"> {
  let name: string | null = null;
  let geburtsdatum: string | null = null;
  let datum: string | null = null;
  let phase: string | null = null;

  for (const a of absaetze) {
    // Vorlage: "Name: X    geb.: TT.MM.JJJJ    Phase 1" / "Datum: TT.MM.JJJJ"
    const nm = a.match(/^Name:\s*(.+?)(?:\s{2,}|$)/);
    if (nm && !name) name = nm[1].trim();
    const geb = a.match(/geb\.?:?\s*(\d{2}\.\d{2}\.\d{2,4})/i);
    if (geb && !geburtsdatum) geburtsdatum = geb[1];
    const ph = a.match(/Phase\s+(\S+)/i);
    if (ph && !phase) phase = `Phase ${ph[1]}`;
    const dt = a.match(/^Datum:\s*(\d{2}\.\d{2}\.\d{2,4})/);
    if (dt && !datum) datum = dt[1];
    // Altformat: "Mariana Sutekova NEM Produkte 01.08.26" in einer Zeile
    const alt = a.match(/^(.+?)\s+NEM[ -]?Produkte\s+(\d{2}\.\d{2}\.\d{2,4})/i);
    if (alt) {
      if (!name) name = alt[1].replace(/\s+geb\.?\s*\S+/i, "").trim();
      if (!datum) datum = alt[2];
    }
  }
  return { name, geburtsdatum, datum, phase };
}

const FREITEXT_ZEILE =
  /^(.+?)\s+(\d+(?:[.,]\d+)?)\s*€\s*(?:(\d+)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*€)?\s*$/i;

export function parseNemDokument(puffer: Buffer): NemDokument {
  const { absaetze, tabellen } = docxAuspacken(puffer);
  const meta = metaLesen(absaetze);
  const positionen: NemPosition[] = [];

  // 1) Tabellen-Format (einheitliche Vorlage)
  for (const tabelle of tabellen) {
    for (const zeile of tabelle) {
      const kopf = zeile[0]?.toLowerCase() ?? "";
      if (kopf.startsWith("produkt") || kopf.startsWith("summe")) continue;
      const menge = deZahl(zeile[1]) ?? 1;
      const preis = deZahl(zeile[2]);
      if (!zeile[0] || preis === null) continue;
      positionen.push({ bezeichnung: zeile[0], menge, einzelpreis: preis });
    }
  }
  if (positionen.length > 0) {
    return { ...meta, positionen, format: "tabelle" };
  }

  // 2) Freitext-Format (alte Listen)
  for (const a of absaetze) {
    if (/^(summe|phase\b|.*NEM[ -]?Produkte)/i.test(a)) continue;
    const m = a.match(FREITEXT_ZEILE);
    if (!m) continue;
    const bezeichnung = m[1].trim();
    if (!bezeichnung || bezeichnung.length < 3) continue;
    const einzel = deZahl(m[2]);
    const menge = m[3] ? Number(m[3]) : 1;
    if (einzel === null) continue;
    positionen.push({ bezeichnung, menge, einzelpreis: einzel });
  }
  if (positionen.length === 0) {
    throw new Error(
      "Keine Produktzeilen gefunden — weder Tabelle (Vorlage) noch Freitext mit Preisen (…,– €).",
    );
  }
  return { ...meta, positionen, format: "freitext" };
}
