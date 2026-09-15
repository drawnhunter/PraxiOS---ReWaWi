// ── Anhang-Inhaltserkennung: PDF (pdftotext, OCR-Fallback) + Bilder (Tesseract) ──
// Serverseitig (kein Dokument verlässt die Instanz; poppler+tesseract stecken
// bereits im Docker-Image). Gibt lesbaren Text an die Agent-API zurück.
import { execFile } from "node:child_process";
import { writeFile, unlink, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const PDF_MAX_SEITEN = 30;
const OCR_MAX_SEITEN = 8; // OCR ist teuer — die wichtigen Daten stehen vorn
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

/** Ein Bild per Tesseract lesen. Gibt "" zurück, wenn nichts erkannt wurde. */
async function ocrBild(bildPfad: string): Promise<string> {
  const ausgabe = bildPfad.replace(/\.(png|jpg)$/, "");
  try {
    await execAsync("tesseract", [bildPfad, ausgabe, "-l", "deu+eng", "--psm", "6", "txt"]);
    const text = (await readFile(`${ausgabe}.txt`, "utf8")).trim();
    await unlink(`${ausgabe}.txt`).catch(() => {});
    return text;
  } catch {
    await unlink(`${ausgabe}.txt`).catch(() => {});
    return "";
  }
}

/** Scan-PDF ohne Textebene: Seiten rendern (pdftoppm) und per OCR lesen. */
async function ocrPdf(pdfPfad: string): Promise<string> {
  const praefix = pdfPfad.replace(/\.pdf$/, "");
  await execAsync("pdftoppm", ["-f", "1", "-l", String(OCR_MAX_SEITEN), "-r", "200", "-png", pdfPfad, praefix]);
  const seiten = (await readdir(tmpdir()))
    .filter((f) => f.startsWith(basename(praefix)) && f.endsWith(".png"))
    .sort();
  const teile: string[] = [];
  for (const s of seiten) {
    const bild = join(tmpdir(), s);
    const text = await ocrBild(bild);
    if (text) teile.push(text);
    await unlink(bild).catch(() => {});
  }
  return teile.join("\n\n").trim();
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
      // 1) Textebene (pdftotext) — Fehler/kein Text fällt auf OCR zurück
      let text = "";
      try {
        text = await execAsync("pdftotext", ["-f", "1", "-l", String(PDF_MAX_SEITEN), "-layout", pfad, "-"]);
      } catch { /* kaputtes PDF → OCR versuchen */ }
      const gekuerzt = text.slice(0, TEXT_MAX).trim();
      if (gekuerzt) return { ok: true, methode: "pdftotext", text: gekuerzt };
      // 2) OCR-Fallback: Scan ohne Textebene (Notar-/Steuer-Post etc.)
      const ocr = (await ocrPdf(pfad)).slice(0, TEXT_MAX).trim();
      if (ocr) return { ok: true, methode: "pdftoppm+tesseract", text: ocr };
      return { ok: false, methode: "pdftotext+ocr", fehler: "PDF enthält auch per OCR keinen lesbaren Text." };
    } finally {
      await unlink(pfad).catch(() => {});
    }
  }

  if (istBild) {
    const pfad = tmpPfad(mime.endsWith("png") ? "png" : "jpg");
    try {
      await writeFile(pfad, puffer);
      const text = (await ocrBild(pfad)).slice(0, TEXT_MAX).trim();
      if (!text) return { ok: false, methode: "tesseract", fehler: "Kein Text im Bild erkannt." };
      return { ok: true, methode: "tesseract", text };
    } finally {
      await unlink(pfad).catch(() => {});
    }
  }

  return { ok: false, methode: "—", fehler: `Typ nicht unterstützt (${mime}) — PDF oder JPG/PNG.` };
}
