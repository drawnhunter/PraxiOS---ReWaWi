// ZUGFeRD/Factur-X: eingebettete XML-Datei aus einer PDF extrahieren.
// Die PDF-Struktur wird direkt durchsucht (Filespec -> EmbeddedFile -> Stream,
// i. d. R. FlateDecode-komprimiert) — bewusst ohne schwere PDF-Bibliothek.
import zlib from "zlib";

export function extrahiereXmlAusPdf(pdfBuffer: Buffer): string | null {
  // 1) Filespec mit Dateinamen der Einbettung finden
  const text = pdfBuffer.toString("latin1");
  const filespecIdx = text.search(/\/Filespec/i);
  if (filespecIdx === -1) return null;

  // 2) Das Stream-Objekt der Einbettung finden: Das Objekt mit dem
  // Schluessel /EmbeddedFile im Dictionary, dem ein "stream" folgt.
  let objIdx = -1;
  let suchVon = 0;
  while (true) {
    const kandidat = text.indexOf("/EmbeddedFile", suchVon);
    if (kandidat === -1) break;
    const folge = text.slice(kandidat, kandidat + 600);
    if (folge.includes("/Length") && folge.includes("stream")) {
      objIdx = kandidat;
      break;
    }
    suchVon = kandidat + 1;
  }
  if (objIdx === -1) return null;

  // 4) Stream-Grenzen bestimmen
  const streamStart = text.indexOf("stream", objIdx);
  if (streamStart === -1) return null;
  let datenStart = streamStart + "stream".length;
  if (text[datenStart] === "\r" && text[datenStart + 1] === "\n") datenStart += 2;
  else if (text[datenStart] === "\n") datenStart += 1;
  const streamEnde = text.indexOf("endstream", datenStart);
  if (streamEnde === -1) return null;

  const rohdaten = pdfBuffer.subarray(datenStart, streamEnde);

  // 5) Dekomprimieren (FlateDecode) oder roh verwenden
  const kandidaten: Buffer[] = [];
  try {
    kandidaten.push(zlib.inflateSync(rohdaten));
  } catch {
    /* nicht komprimiert */
  }
  kandidaten.push(rohdaten);

  for (const k of kandidaten) {
    const s = k.toString("utf8");
    if (s.includes("CrossIndustryInvoice") || s.includes("<?xml")) return s;
  }
  return null;
}
