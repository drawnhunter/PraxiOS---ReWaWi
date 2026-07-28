// ── Datei-Downloads im Browser ──────────────────────────────────────────────

/** Löst im Browser einen Download einer Binärdatei aus. */
export function blobHerunterladen(dateiname: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = dateiname;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** PDF aus der tRPC-Antwort (Base64) herunterladen. */
export function pdfHerunterladen(antwort: { dateiname: string; base64: string }) {
  const bin = atob(antwort.base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  blobHerunterladen(antwort.dateiname, new Blob([bytes], { type: "application/pdf" }));
}

/** Textdatei (XML o.ä.) herunterladen — ohne BOM, damit Validatoren nicht murren. */
export function textHerunterladen(dateiname: string, inhalt: string, mime: string) {
  blobHerunterladen(dateiname, new Blob([inhalt], { type: `${mime};charset=utf-8` }));
}

/** Dezimalzahl deutsch formatieren ("1234.5" → "1234,5") für Excel-CSV. */
export function deZahl(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "";
  return String(v).replace(".", ",");
}

/**
 * CSV herunterladen — Excel-tauglich für deutsche Systeme:
 * Semikolon als Trenner, UTF-8-BOM, CRLF-Zeilenenden.
 */
export function csvHerunterladen(
  dateiname: string,
  zeilen: (string | number | null | undefined)[][],
) {
  const feld = (v: string | number | null | undefined): string => {
    const s = String(v ?? "");
    return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = "﻿" + zeilen.map((z) => z.map(feld).join(";")).join("\r\n");
  blobHerunterladen(
    dateiname,
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
}
