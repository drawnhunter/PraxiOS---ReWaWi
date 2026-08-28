// ── SumUp Geschäftskonto: Kontoauszug als PDF (Textebene, kein OCR) ─────────
// Der Auszug enthält stabile Transaktions-IDs UND den Saldo nach jeder Buchung
// — datenqualitativ besser als der CSV-Vollexport. IDs sind identisch zu denen
// des Vollexports → Duplikat-Schutz greift formatübergreifend.

export interface AuszugZeile {
  datum: string; // ISO YYYY-MM-DD
  betrag: number; // + eingehend / − ausgehend
  name: string;
  zweck: string;
  gebuehr: number | null;
  saldo: number | null;
  txId: string;
}

export interface AuszugMeta {
  iban: string | null;
  anfangsSaldo: number | null;
  endSaldo: number | null;
  pruefsummeOk: boolean | null; // null = Kopfzeilen fehlten, kein Abgleich möglich
}

const ARTEN = [
  "Ausgehende Banküberweisung",
  "Eingehende Banküberweisung",
  "POS-Zahlung",
  "Online-Zahlung",
  "Kartenzahlung",
  "Lastschrift",
  "Auszahlung",
  "Überweisung",
  // In der Layout-Textebene umbrochen: Zelle trägt erst "Ausgehende",
  // "Banküberweisung" folgt als Fortsetzungszeile — wird unten zusammengeführt
  "Ausgehende",
  "Eingehende",
] as const;

const STATUS = /^(Genehmigt|Ausstehend|In Bearbeitung|Abgelehnt|Fehlgeschlagen|Storniert)$/i;
const STATUS_SKIP = /^(in bearbeitung|abgelehnt|fehlgeschlagen|storniert|ausstehend)$/i;

// Zeilen, die keine Buchung sind (Kopf/Fuß des Auszugs)
const ZEILEN_SKIP =
  /^(Noch Fragen\?|Bitte besuchen|http|SumUp Account|Berichtzeitraum|Kundennummer:|Erstellt in:|Kartennummer:|Datum der|Transaktion$|ausgehend|SumUp Limited|Block 8,|Dublin |USt-IdNr|ist ein E-Geld|das von der|\(Referenz Nr)/;

const START = /^(\d{2})\.(\d{2})\.(\d{2}),\s+([A-Z0-9]{10})\s+(.*)$/;
const ZEIT = /^\d{2}:\d{2}\s*/;
// Vier Zahlenkolonnen am Zeilenende: ausgehend, eingehend, Gebühr, Saldo
const ENDCLUSTER =
  /(-?[\d][\d.]*[.,]\d{2})\s+(-?[\d][\d.]*[.,]\d{2})\s+(-?[\d][\d.]*[.,]\d{2})\s+(-?[\d][\d.]*[.,]\d{2})\s*$/;

function betragLesen(roh: string): number | null {
  const t = roh.trim().replace(/\s/g, "");
  if (!t) return null;
  // Deutsch "1.234,56" oder englisch "1234.56" (SumUp nutzt im Auszug Punkte)
  const n = t.includes(",")
    ? Number(t.replace(/\./g, "").replace(",", "."))
    : Number(t);
  return Number.isFinite(n) ? n : null;
}

function datumIso(t: string, m: string, j: string): string {
  return `20${j}-${m}-${t}`;
}

/**
 * Zerlegt die normalisierten Textzeilen eines SumUp-Kontoauszugs in Buchungen.
 * Rein synchron und ohne PDF-Abhängigkeit — direkt testbar.
 */
export function zerlegeAuszugZeilen(textZeilen: string[]): {
  zeilen: AuszugZeile[];
  uebersprungen: number;
  meta: AuszugMeta;
} {
  const zeilen: AuszugZeile[] = [];
  let uebersprungen = 0;
  const meta: AuszugMeta = { iban: null, anfangsSaldo: null, endSaldo: null, pruefsummeOk: null };

  let offen: AuszugZeile | null = null;
  const fortsetzung: string[] = [];

  const abschliessen = () => {
    if (!offen) return;
    // Umbrochene Art-Zelle: "Ausgehende" + Fortsetzung "Banküberweisung …"
    if (
      (offen.zweck === "Ausgehende" || offen.zweck === "Eingehende") &&
      fortsetzung[0]?.startsWith("Banküberweisung")
    ) {
      offen.zweck = `${offen.zweck} Banküberweisung`;
      fortsetzung[0] = fortsetzung[0].slice("Banküberweisung".length).trim();
      if (!fortsetzung[0]) fortsetzung.shift();
    }
    const rest = fortsetzung.join(" ").replace(/\s{2,}/g, " ").trim();
    if (rest) offen.zweck = [offen.zweck, rest].filter(Boolean).join(" · ");
    zeilen.push(offen);
    offen = null;
    fortsetzung.length = 0;
  };

  for (const roh of textZeilen) {
    const zeile = roh.replace(/\s+/g, " ").trim();
    if (!zeile) continue;

    // Kopf-Metadaten (vor den Buchungen)
    const iban = zeile.match(/^IBAN:\s*([A-Z0-9]{15,34})/);
    if (iban) meta.iban = iban[1];
    const anfang = zeile.match(/Anfangsguthaben:\s*(-?[\d.,]+)/);
    if (anfang) meta.anfangsSaldo = betragLesen(anfang[1]);
    const ende = zeile.match(/Endguthaben:\s*(-?[\d.,]+)/);
    if (ende) meta.endSaldo = betragLesen(ende[1]);

    if (ZEILEN_SKIP.test(zeile)) continue;

    const start = zeile.match(START);
    if (start) {
      abschliessen();
      const [, tt, mm, jj, txid, rest] = start;

      // Status + vier Zahlenkolonnen (ausgehend, eingehend, Gebühr, Saldo) am Zeilenende
      const endM = rest.match(ENDCLUSTER);
      if (!endM || endM.index === undefined) { uebersprungen++; continue; }
      const vier = endM.slice(1, 5);
      const vorZahlen = rest.slice(0, endM.index).trim();

      // Status ist das letzte Wort vor den Zahlen
      const worte = vorZahlen.split(" ");
      let status = "";
      while (worte.length && !status) {
        const kandidat = worte[worte.length - 1];
        if (STATUS.test(kandidat)) status = worte.pop() as string;
        else break;
      }
      if (!status) { uebersprungen++; continue; }
      if (STATUS_SKIP.test(status)) { uebersprungen++; continue; }

      let kopf = worte.join(" ").trim();
      // Art der Transaktion vom Zeilenanfang abtrennen
      let art = "";
      for (const a of ARTEN) {
        if (kopf.startsWith(a)) { art = a; kopf = kopf.slice(a.length).trim(); break; }
      }

      // Angehängte IBAN im Namen abschneiden (Volltext bleibt im Zweck)
      const name = kopf
        .replace(/\s+[A-Z]{2}\d{2}[A-Z0-9]{9,30}$/, "")
        .replace(/\s{2,}/g, " ")
        .trim();

      const aus = betragLesen(vier[0]) ?? 0;
      const ein = betragLesen(vier[1]) ?? 0;
      const geb = betragLesen(vier[2]);
      const saldo = betragLesen(vier[3]);

      offen = {
        datum: datumIso(tt, mm, jj),
        betrag: Math.round((ein - aus) * 100) / 100,
        name: name || art || txid,
        zweck: art,
        gebuehr: geb !== null && Math.abs(geb) > 0.004 ? geb : null,
        saldo,
        txId: txid,
      };
      continue;
    }

    // Fortsetzungszeile (Uhrzeit am Anfang abstreifen), IBAN/Verwendungszweck etc.
    if (offen) {
      const rest = zeile.replace(ZEIT, "").trim();
      if (rest) fortsetzung.push(rest);
    }
  }
  abschliessen();

  // Plausibilität: Anfang + Summe Buchungen = Ende (wenn Kopf vorhanden)
  if (meta.anfangsSaldo !== null && meta.endSaldo !== null && zeilen.length > 0) {
    const summe = zeilen.reduce((a, z) => a + z.betrag, 0);
    meta.pruefsummeOk =
      Math.abs(meta.anfangsSaldo + summe - meta.endSaldo) < 0.02;
  }

  return { zeilen, uebersprungen, meta };
}

/** Textzeilen aus der PDF-Textebene via poppler `pdftotext -layout` extrahieren. */
export async function extrahiereTextZeilen(puffer: Uint8Array): Promise<string[]> {
  const { execFile } = await import("node:child_process");
  const { writeFile, unlink } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  const pfad = join(tmpdir(), `sumup-auszug-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
  await writeFile(pfad, puffer);
  try {
    const text: string = await new Promise((resolve, reject) => {
      execFile(
        "pdftotext",
        ["-layout", pfad, "-"],
        { maxBuffer: 16 * 1024 * 1024 },
        (err, stdout) => (err ? reject(err) : resolve(stdout)),
      );
    });
    return text.split("\n");
  } catch (e) {
    throw new Error(
      "PDF konnte nicht gelesen werden (pdftotext fehlt? Im Docker-Image ist poppler-utils enthalten).",
      { cause: e },
    );
  } finally {
    await unlink(pfad).catch(() => {});
  }
}

/** Kompletter Einstieg: PDF-Puffer → Buchungen + Meta + Plausibilität. */
export async function liesSumUpKontoauszug(puffer: Uint8Array): Promise<{
  zeilen: AuszugZeile[];
  uebersprungen: number;
  meta: AuszugMeta;
}> {
  const zeilen = await extrahiereTextZeilen(puffer);
  const text = zeilen.join("\n");
  if (!/SumUp Account Kontoauszug/.test(text) || !/Transaktions-ID/.test(text)) {
    throw new Error(
      "Das ist kein SumUp-Geschäftskonto-Kontoauszug. Erkannt wird die PDF aus dem SumUp-Bereich „Geschäftskonto → Kontoauszug“.",
    );
  }
  const ergebnis = zerlegeAuszugZeilen(zeilen);
  if (ergebnis.zeilen.length === 0) {
    throw new Error("Keine Buchungen im Auszug gefunden — ist der Berichtzeitraum leer?");
  }
  return ergebnis;
}
