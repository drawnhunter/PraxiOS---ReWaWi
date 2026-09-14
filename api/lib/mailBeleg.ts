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
  const datum = m.datum ? new Date(m.datum).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
  const lieferant = (m.absenderName ?? m.absenderAdresse ?? "Unbekannt").slice(0, 255);
  const nummer = `BELEG-MAIL-${m.id}${anhangIndex !== undefined ? `-${anhangIndex}` : ""}`;
  const vorhanden = await db.query.incomingInvoices.findFirst({ where: eq(incomingInvoices.nummer, nummer) });
  if (vorhanden) throw new Error(`Bereits als Beleg erfasst (Beleg #${vorhanden.id}).`);

  const s = await db.query.companySettings.findFirst({ where: eq(companySettings.id, 1) });
  const [{ id }] = await db
    .insert(incomingInvoices)
    .values({
      lieferantName: lieferant,
      nummer,
      rechnungsdatum: datum,
      netto: "0.00",
      ust: "0.00",
      brutto: "0.00",
      konto: s?.aufwandskontoDefault ?? "4900",
      kategorieId: null,
      belegBase64: base64,
      belegMime: mime,
      bemerkung: `Aus E-Mail „${(m.betreff ?? "").slice(0, 200)}" vom ${datum} — Betrag bitte nachtragen (Eingangsbelege).`,
    })
    .$returningId();
  return { belegId: id, hinweis: "Eingangsbeleg angelegt (Betrag in Eingangsbelege nachtragen)." };
}
