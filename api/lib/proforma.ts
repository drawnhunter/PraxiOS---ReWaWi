// ── Proforma/Vorschuss (v1.21.0, Bus #123): geteilte Logik für tRPC + Agent-API ──
import { eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { invoices, companySettings, bankAccounts } from "@db/schema";
import { nextNumber, formatInvoiceNumber } from "../queries/invoicing";

/** Nummernkreis-Finalisierung (kollisionssicher, Snapshots) — teilt sich finalize + umwandeln. */
export async function finalisiereIntern(invoiceId: number): Promise<{ id: number; nummer: string }> {
  const db = getDb();
  const rechnung = await db.query.invoices.findFirst({
    where: eq(invoices.id, invoiceId),
    with: { items: true },
  });
  if (!rechnung) throw new Error("Rechnung nicht gefunden.");
  if (!["entwurf", "proforma"].includes(rechnung.status)) throw new Error(`Status „${rechnung.status}" erlaubt keine Finalisierung.`);
  if (rechnung.items.length === 0) throw new Error("Rechnung ohne Positionen kann nicht finalisiert werden.");

  const settings = await db.query.companySettings.findFirst({ where: eq(companySettings.id, 1) });
  if (!settings) throw new Error("Firmen-Einstellungen fehlen.");
  const bank = rechnung.bankAccountId
    ? await db.query.bankAccounts.findFirst({ where: eq(bankAccounts.id, rechnung.bankAccountId) })
    : undefined;
  const firmenSnapshot = JSON.stringify({
    name: settings.name, strasse: settings.strasse, plz: settings.plz, ort: settings.ort,
    land: settings.land, handelsregister: settings.handelsregister, steuernummer: settings.steuernummer,
    ustIdNr: settings.ustIdNr, email: settings.email, telefon: settings.telefon,
    webseite: settings.webseite, fussText: settings.fussText,
  });
  const bankSnapshot = bank
    ? JSON.stringify({ bezeichnung: bank.bezeichnung, bankName: bank.bankName, kontoinhaber: bank.kontoinhaber, iban: bank.iban, bic: bank.bic })
    : null;

  const jahr = Number(rechnung.rechnungsdatum.slice(0, 4));
  const nummer = await db.transaction(async (tx) => {
    for (let versuch = 0; versuch < 1000; versuch++) {
      const n = await nextNumber(tx, "invoice", jahr);
      const nr = formatInvoiceNumber(jahr, n);
      const [kollision] = await tx.select({ id: invoices.id }).from(invoices).where(eq(invoices.nummer, nr)).limit(1);
      if (kollision) continue;
      await tx
        .update(invoices)
        .set({
          nummer: nr,
          status: "finalisiert",
          typ: "rechnung",
          finalizedAt: new Date(),
          firmenSnapshot,
          bankSnapshot,
          ...(rechnung.bereitsBezahlt ? { bezahltBetrag: rechnung.brutto, bezahltAm: rechnung.rechnungsdatum } : {}),
        })
        .where(eq(invoices.id, invoiceId));
      return nr;
    }
    throw new Error("Keine freie Rechnungsnummer im Kreis gefunden.");
  });
  return { id: invoiceId, nummer };
}

/** Entwurf → Proforma (finalisiert OHNE Nummernkreis-Nummer, GoBD: nur Ausdruck „Proforma"). */
export async function proformaSetzenIntern(invoiceId: number): Promise<{ id: number }> {
  const db = getDb();
  const r = await db.query.invoices.findFirst({ where: eq(invoices.id, invoiceId), with: { items: true } });
  if (!r) throw new Error("Rechnung nicht gefunden.");
  if (r.status !== "entwurf") throw new Error(`Status „${r.status}" — nur Entwürfe werden zur Proforma.`);
  if (r.items.length === 0) throw new Error("Ohne Positionen keine Proforma.");
  await db
    .update(invoices)
    .set({ status: "proforma", typ: "proforma", finalizedAt: new Date() })
    .where(eq(invoices.id, invoiceId));
  return { id: invoiceId };
}

/** Vorkasse setzen (nur im Proforma-Status): abschlagBetrag = bezahlter Betrag. */
export async function vorkasseSetzenIntern(invoiceId: number): Promise<{ id: number; abschlagBetrag: string }> {
  const db = getDb();
  const r = await db.query.invoices.findFirst({ where: eq(invoices.id, invoiceId) });
  if (!r) throw new Error("Rechnung nicht gefunden.");
  if (r.status !== "proforma") throw new Error("Vorkasse setzen geht nur im Proforma-Status (erst proforma-setzen).");
  const betrag = Number(r.bezahltBetrag);
  if (betrag <= 0) throw new Error("Erst Zahlung verbuchen (POST /rechnung/:id/zahlung), dann Vorkasse setzen.");
  await db.update(invoices).set({ abschlagBetrag: r.bezahltBetrag }).where(eq(invoices.id, invoiceId));
  return { id: invoiceId, abschlagBetrag: r.bezahltBetrag };
}

/** Proforma → echte Rechnung (Nummernkreis + Snapshots wie finalize). */
export async function umwandelnIntern(invoiceId: number): Promise<{ id: number; nummer: string }> {
  const db = getDb();
  const r = await db.query.invoices.findFirst({ where: eq(invoices.id, invoiceId) });
  if (!r) throw new Error("Rechnung nicht gefunden.");
  if (r.status !== "proforma") throw new Error(`Status „${r.status}" — nur Proforma wird umgewandelt.`);
  return finalisiereIntern(invoiceId);
}
