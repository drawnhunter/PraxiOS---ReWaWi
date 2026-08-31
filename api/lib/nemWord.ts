// ── NEM-Word-Import: .docx (Tabelle oder Freitext) → strukturierte Positionen ─
// Unterstützt zwei Formate:
//  1) Einheitliche Vorlage (Tabelle: Produkt | Menge | Einzelpreis | Summe)
//  2) Alte Freitext-Listen ("Pro Mucosa 73,95€", "Pro PEA 800 28,43€ 2x 56,86€")

import { inflateRawSync } from "node:zlib";

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
  const sauber = s.replace(/[€\s]/g, "");
  if (!sauber) return null;
  const n = Number(sauber.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Minimaler ZIP-Leser (Store + Deflate) über node:zlib — keine Zusatz-Dependency. */
function zipEntpacken(buf: Buffer): Map<string, Buffer> {
  const dateien = new Map<string, Buffer>();
  // End Of Central Directory von hinten suchen (Signatur PK\x05\x06)
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Keine ZIP-Datei (Endverzeichnis fehlt).");
  const anzahl = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);

  for (let i = 0; i < anzahl; i++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) break; // Zentraleintrag
    const methode = buf.readUInt16LE(pos + 10);
    const groessePaket = buf.readUInt32LE(pos + 20);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const kommentarLen = buf.readUInt16LE(pos + 32);
    const lokalOffset = buf.readUInt32LE(pos + 42);
    const name = buf.subarray(pos + 46, pos + 46 + nameLen).toString("utf8");

    // Lokaler Header → Datenanfang
    const nameLenLokal = buf.readUInt16LE(lokalOffset + 26);
    const extraLenLokal = buf.readUInt16LE(lokalOffset + 28);
    const datenStart = lokalOffset + 30 + nameLenLokal + extraLenLokal;
    const roh = buf.subarray(datenStart, datenStart + groessePaket);

    if (methode === 0) {
      dateien.set(name, Buffer.from(roh));
    } else if (methode === 8) {
      dateien.set(name, inflateRawSync(roh));
    }
    pos += 46 + nameLen + extraLen + kommentarLen;
  }
  return dateien;
}

/** docx (zip) → reiner Text je Absatz sowie Tabellenzeilen. */
export function docxAuspacken(puffer: Buffer): { absaetze: string[]; tabellen: string[][][] } {
  const dateien = zipEntpacken(puffer);
  const docXml = dateien.get("word/document.xml");
  if (!docXml) throw new Error("Keine gültige Word-Datei (word/document.xml fehlt).");
  const xml = docXml.toString("utf8");

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
      positionen.push({ bezeichnung: zeile[0].replace(/\s{2,}/g, " ").trim(), menge, einzelpreis: preis });
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
    const bezeichnung = m[1].replace(/\s{2,}/g, " ").trim();
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

/** Geteilte Anlage: Lieferschein-Entwurf aus einem geparsten NEM-Dokument.
    (genutzt von Lieferscheine → NEM-Word-Import und Magic Import) */
export async function legeLieferscheinAusNemAn(
  customerId: number,
  dok: NemDokument,
  dateiname: string,
): Promise<{ id: number }> {
  const { getDb } = await import("../queries/connection");
  const { deliveryNotes, deliveryNoteItems, customers } = await import("@db/schema");
  const { eq } = await import("drizzle-orm");

  const db = getDb();
  const kunde = await db.query.customers.findFirst({ where: eq(customers.id, customerId) });
  if (!kunde) throw new Error("Kunde nicht gefunden.");

  const [{ id }] = await db
    .insert(deliveryNotes)
    .values({
      customerId: kunde.id,
      datum: new Date().toISOString().slice(0, 10),
      pdfNotiz: [dok.phase, dok.name ? `NEM: ${dok.name}` : ""].filter(Boolean).join(" · ") || null,
      bemerkung: `Import aus Word: ${dateiname}`,
      kundeName: kunde.name,
      kundeZusatz: kunde.zusatz,
      kundeStrasse: kunde.strasse,
      kundePlz: kunde.plz,
      kundeOrt: kunde.ort,
      kundeLand: kunde.land,
    })
    .$returningId();

  await db.insert(deliveryNoteItems).values(
    dok.positionen.map((p, i) => ({
      deliveryNoteId: id,
      position: i + 1,
      bezeichnung: p.bezeichnung,
      menge: String(p.menge),
      einheit: "Packung",
    })),
  );
  return { id };
}
