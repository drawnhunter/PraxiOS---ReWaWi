// ── Anhang-Inhaltserkennung: PDF (pdftotext) + Bilder (Tesseract OCR) ──────
// Serverseitig (kein Dokument verlässt die Instanz; poppler+tesseract stecken
// bereits im Docker-Image). Gibt lesbaren Text an die Agent-API zurück.
import { execFile } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PDF_MAX_SEITEN = 30;
const TEXT_MAX = 120_000;

function tmpPfad(ext: string): string {
  return join(tmpdir(), `anhang-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);
}

function execAsync(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 32 * 1024 * 1024, timeout: 90_000 }, (err, stdout) =>
      err ? reject(err) : resolve(stdout),
    );
  });
}

/** Extrahiert Text aus einer Datei (PDF via pdftotext, Bild via tesseract). */
export async function extrahiereAnhangText(
  puffer: Buffer,
  mime: string,
): Promise<{ ok: boolean; text?: string; methode: string; fehler?: string }> {
  const istPdf = mime === "application/pdf" || mime.endsWith("/pdf");
  const istBild = /^image\/(jpeg|jpg|png)$/.test(mime);

  if (istPdf) {
    const pfad = tmpPfad("pdf");
    try {
      await writeFile(pfad, puffer);
      // Erst bis zu N Seiten (Schutz vor Riesen-PDFs)
      const text = await execAsync("pdftotext", ["-f", "1", "-l", String(PDF_MAX_SEITEN), "-layout", pfad, "-"]);
      const gekuerzt = text.slice(0, TEXT_MAX).trim();
      if (!gekuerzt) return { ok: false, methode: "pdftotext", fehler: "PDF enthält keinen Text (Scan ohne Textebene?)" };
      return { ok: true, methode: "pdftotext", text: gekuerzt };
    } finally {
      await unlink(pfad).catch(() => {});
    }
  }

  if (istBild) {
    const pfad = tmpPfad(mime.endsWith("png") ? "png" : "jpg");
    try {
      await writeFile(pfad, puffer);
      const ausgabe = pfad.replace(/\.(png|jpg)$/, "");
      await execAsync("tesseract", [pfad, ausgabe, "-l", "deu+eng", "--psm", "6", "txt"]);
      const { readFile } = await import("node:fs/promises");
      const text = (await readFile(`${ausgabe}.txt`, "utf8")).slice(0, TEXT_MAX).trim();
      await unlink(`${ausgabe}.txt`).catch(() => {});
      if (!text) return { ok: false, methode: "tesseract", fehler: "Kein Text im Bild erkannt." };
      return { ok: true, methode: "tesseract", text };
    } finally {
      await unlink(pfad).catch(() => {});
    }
  }

  return { ok: false, methode: "—", fehler: `Typ nicht unterstützt (${mime}) — PDF oder JPG/PNG.` };
}
