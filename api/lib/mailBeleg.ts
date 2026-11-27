// ── Mail → Eingangsbeleg (geteilt: Postfach-UI + Agent-API) ────────────────
import { eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { mailMails, postEingang } from "@db/schema";

export interface AnhangMeta {
  name: string;
  mime: string;
  groesse: number;
  postEingangId: number | null;
}

export function metaLesen(anhaenge: string | null): AnhangMeta[] {
  if (!anhaenge) return [];
  try {
    return JSON.parse(anhaenge) as AnhangMeta[];
  } catch {
    return [];
  }
}

/** Legt aus einer Mail (oder einem Anhang) einen Eingangsbeleg an. */
// ── DSGVO-Importfilter (#217): Medizinische Dokumente werden NICHT automatisch
// als Beleg angelegt — nur bei echten Rechnungs-Signalen. Blockliste ist in den
// Einstellungen pflegbar (company_settings.beleg_blockliste, kommagetrennt).
const MEDIZIN_DEFAULT = [
  "befund", "diagnostik", "laborbefund", "laborwerte", "anamnese", "einverständnis",
  "einverstaendnis", "patient", "arztbrief", "therapieplan", "zytokin", "tumor",
  "diagnose", "medikationsplan", "immunogramm", "zytologie", "blutbild", "krebs",
];

function ladeBlockliste(custom: string | null | undefined): string[] {
  const liste = (custom ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  return liste.length > 0 ? liste : MEDIZIN_DEFAULT;
}

function rechnungsSignale(text: string): boolean {
  return /rechnung|invoice|rg\.?\s?-?nr\.?|rechnungsnummer|iban\s*[:]|zahlungserinnerung/i.test(text)
    || /\d+[.,]\d{2}\s*(?:€|eur|euro)/i.test(text);
}

function medizinVerdacht(text: string, liste: string[]): string | null {
  const t = text.toLowerCase();
  return liste.find((k) => t.includes(k)) ?? null;
}

export async function alsBelegIntern(
  mailId: number,
  anhangIndex?: number,
): Promise<{ belegId: number; hinweis: string }> {
  const db = getDb();
  const m = await db.query.mailMails.findFirst({ where: eq(mailMails.id, mailId) });
  if (!m) throw new Error("Mail nicht gefunden.");

  let base64: string | null = null;
  let mime: string | null = null;
  if (anhangIndex !== undefined) {
    const meta = metaLesen(m.anhaenge)[anhangIndex];
    if (!meta?.postEingangId) throw new Error("Anhang hat keinen Post-Manager-Eintrag (Typ nicht gespeichert).");
    const beleg = await db.query.postEingang.findFirst({ where: eq(postEingang.id, meta.postEingangId) });
    if (!beleg?.dateiInhalt) throw new Error("Anhang-Datei nicht gefunden.");
    base64 = beleg.dateiInhalt;
    mime = beleg.mime;
  }

  const { incomingInvoices, companySettings } = await import("@db/schema");
  let datum = m.datum ? new Date(m.datum).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
  let lieferant = (m.absenderName ?? m.absenderAdresse ?? "Unbekannt").slice(0, 255);
  const nummer = `BELEG-MAIL-${m.id}${anhangIndex !== undefined ? `-${anhangIndex}` : ""}`;
  const vorhanden = await db.query.incomingInvoices.findFirst({ where: eq(incomingInvoices.nummer, nummer) });
  if (vorhanden) throw new Error(`Bereits als Beleg erfasst (Beleg #${vorhanden.id}).`);

  // Auto-Extraktion (v1.19): Anhang OCR'en → Beträge/Datum/Nummer vorbefüllen
  let nettoS = "0.00", ustS = "0.00", bruttoS = "0.00";
  let autoHinweis = "";
  let ocrText: string | null = null;
  if (base64 && mime) {
    try {
      const { extrahiereAnhangText } = await import("./anhangText");
      const { extrahiereBelegFelder } = await import("./belegExtraktion");
      const text = await extrahiereAnhangText(Buffer.from(base64, "base64"), mime);
      if (text.ok && text.text) {
        ocrText = text.text.slice(0, 2_000_000);
        const f = extrahiereBelegFelder(text.text);
        const dezimal = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));
        if (f.brutto && f.brutto.konfidenz >= 0.7) {
          const brutto = dezimal(f.brutto.wert);
          bruttoS = brutto.toFixed(2);
          if (f.mwst) {
            ustS = dezimal(f.mwst.wert).toFixed(2);
            nettoS = (brutto - dezimal(f.mwst.wert)).toFixed(2);
          } else {
            nettoS = (brutto / 1.19).toFixed(2);
            ustS = (brutto - brutto / 1.19).toFixed(2);
          }
          autoHinweis = ` Betrag auto-extrahiert (${f.brutto.wert} €, Konfidenz ${f.brutto.konfidenz}).`;
        }
        if (f.datum && f.datum.konfidenz >= 0.8) datum = f.datum.wert;
        if (f.lieferant && f.lieferant.konfidenz >= 0.6) lieferant = f.lieferant.wert.slice(0, 255);
        if (f.nummer && f.nummer.konfidenz >= 0.8) {
          // OCR-Nummer als Belegnummer statt generischer — Duplikat-Prüfung greift trotzdem über nummer
          autoHinweis += ` Rechnungsnr. erkannt: ${f.nummer.wert}.`;
        }
      }
    } catch { /* Extraktion optional — Beleg wird trotzdem angelegt */ }
  }

  const s = await db.query.companySettings.findFirst({ where: eq(companySettings.id, 1) });

  // v1.22.4 (#217): DSGVO-Importfilter — medizinische Dokumente nur mit echten
  // Rechnungs-Signalen zulassen, sonst blockieren + Audit-Eintrag.
  const pruefText = [m.betreff ?? "", anhangIndex !== undefined ? (metaLesen(m.anhaenge)[anhangIndex]?.name ?? "") : "", (ocrText ?? "").slice(0, 5000)].join(" ");
  const stichwort = medizinVerdacht(pruefText, ladeBlockliste(s?.belegBlockliste));
  if (stichwort && !rechnungsSignale(pruefText)) {
    const { agentLog } = await import("@db/schema");
    await db.insert(agentLog).values({
      aktion: "beleg_medizin_block",
      details: JSON.stringify({ mailId: m.id, anhangIndex, stichwort }),
    }).catch(() => undefined);
    throw new Error(`Medizinisches Dokument erkannt (Stichwort „${stichwort}") — wird aus DSGVO-Gründen NICHT als Beleg angelegt. Wenn es doch eine Rechnung ist: manuell per POST /beleg mit den echten Werten anlegen.`);
  }

  const [{ id }] = await db
    .insert(incomingInvoices)
    .values({
      lieferantName: lieferant,
      nummer,
      rechnungsdatum: datum,
      netto: nettoS,
      ust: ustS,
      brutto: bruttoS,
      konto: s?.aufwandskontoDefault ?? "4900",
      kategorieId: null,
      belegBase64: base64,
      belegMime: mime,
      ocrText,
      bemerkung: `Aus E-Mail „${(m.betreff ?? "").slice(0, 200)}" vom ${datum}.${autoHinweis || " Betrag bitte nachtragen (Eingangsbelege)."}`,
    })
    .$returningId();
  return { belegId: id, hinweis: autoHinweis ? `Eingangsbeleg mit Auto-Extraktion angelegt.${autoHinweis}` : "Eingangsbeleg angelegt (Betrag in Eingangsbelege nachtragen)." };
}
