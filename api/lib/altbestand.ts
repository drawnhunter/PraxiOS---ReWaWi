// Geteilter Altbestand-Buchungskern: wird vom CSV-Import (invoiceImportRouter)
// und vom Datei-Import (SumUp-PDF / XRechnung) gemeinsam genutzt.
// Importiert mit ORIGINAL-Nummern als finalisierte Belege — der eigene
// Nummernkreis bleibt unberuehrt; Kunden werden bei Bedarf angelegt.
//
// v1.2.2: Wenn eine importierte Original-Nummer exakt dem eigenen Kreis-Format
// (JJJJ-NNN, siehe formatInvoiceNumber) entspricht, wird der Zaehler in
// number_sequences auf mindestens diese Nummer angehoben. Hintergrund: Sonst
// vergibt finalize() spaeter eine bereits importierte Nummer → Unique-Fehler
// auf invoices.nummer und dauerhaft blockierte Rechnungserstellung.
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { bankAccounts, companySettings, customers, invoiceItems, invoices, numberSequences } from "@db/schema";
import { centToDecimal, formatInvoiceNumber } from "../queries/invoicing";

export interface AltbestandGruppe {
  nummer: string;
  datum: string | null;
  faellig: string | null;
  kunde: string;
  kundeStrasse: string | null;
  kundePlz: string | null;
  kundeOrt: string | null;
  kundeEmail: string | null;
  /** true = vollstaendig bezahlt */
  bezahlt: boolean;
  /** optionaler expliziter bezahlter Anteil in Cent (Teilzahlung) */
  bezahltBetragCent?: number;
  items: { bezeichnung: string; menge: string; einheit: string; einzelpreis: string; ustSatz: number }[];
  bruttoCent: number;
  nettoCent: number;
  ustCent: number;
}

export interface AltbestandErgebnis {
  importiert: number;
  uebersprungen: number;
  kundenNeu: number;
  fehler: string[];
}

function plusTage(iso: string, tage: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + tage);
  return d.toISOString().slice(0, 10);
}

/** Hebt den eigenen Nummernkreis an, wenn die importierte Nummer im eigenen Format liegt. */
async function kreisAnhebenFallsEigenesFormat(nummer: string): Promise<void> {
  const m = nummer.match(/^(\d{4})-(\d{3,})$/);
  if (!m) return;
  const jahr = Number(m[1]);
  const n = Number(m[2]);
  // Nur wenn die Darstellung exakt der eigenen entspricht (z. B. "2026-003",
  // nicht "2026-3" oder "2026-0003"), ist es wirklich derselbe Kreis.
  if (formatInvoiceNumber(jahr, n) !== nummer) return;
  const db = getDb();
  await db
    .insert(numberSequences)
    .values({ typ: "invoice", jahr, letzteNummer: n })
    .onDuplicateKeyUpdate({
      set: { letzteNummer: sql`GREATEST(letzte_nummer, ${n})` },
    });
}

export async function bucheAltbestand(gruppen: AltbestandGruppe[]): Promise<AltbestandErgebnis> {
  const db = getDb();
  const settings = await db.query.companySettings.findFirst({
    where: eq(companySettings.id, 1),
  });
  if (!settings) throw new Error("Firmen-Einstellungen fehlen.");
  const standardBank = await db.query.bankAccounts.findFirst({
    where: eq(bankAccounts.istStandard, true),
  });
  const firmenSnapshot = JSON.stringify({
    name: settings.name, strasse: settings.strasse, plz: settings.plz,
    ort: settings.ort, land: settings.land, handelsregister: settings.handelsregister,
    steuernummer: settings.steuernummer, ustIdNr: settings.ustIdNr,
    email: settings.email, telefon: settings.telefon, webseite: settings.webseite,
    fussText: settings.fussText,
  });
  const bankSnapshot = standardBank
    ? JSON.stringify({
        bezeichnung: standardBank.bezeichnung, bankName: standardBank.bankName,
        kontoinhaber: standardBank.kontoinhaber, iban: standardBank.iban, bic: standardBank.bic,
      })
    : null;

  let importiert = 0;
  let uebersprungen = 0;
  let kundenNeu = 0;
  const fehler: string[] = [];

  for (const g of gruppen) {
    if (!g.datum) {
      uebersprungen++;
      continue;
    }
    const dup = await db.query.invoices.findFirst({ where: eq(invoices.nummer, g.nummer) });
    if (dup) {
      uebersprungen++;
      fehler.push(`${g.nummer} existiert bereits`);
      continue;
    }

    let kunde = await db.query.customers.findFirst({
      where: and(eq(customers.name, g.kunde), eq(customers.plz, g.kundePlz ?? "")),
    });
    if (!kunde) {
      const [res] = await db
        .insert(customers)
        .values({
          name: g.kunde,
          strasse: g.kundeStrasse ?? "",
          plz: g.kundePlz ?? "",
          ort: g.kundeOrt ?? "",
          land: "Deutschland",
          email: g.kundeEmail,
        })
        .$returningId();
      kunde = await db.query.customers.findFirst({ where: eq(customers.id, res.id) });
      kundenNeu++;
    }

    const vollBezahlt = g.bezahlt;
    const bezahltCent = g.bezahltBetragCent ?? (vollBezahlt ? g.bruttoCent : 0);

    const [res] = await db
      .insert(invoices)
      .values({
        customerId: kunde!.id,
        nummer: g.nummer,
        status: "finalisiert",
        rechnungsdatum: g.datum,
        faelligkeitsdatum: g.faellig ?? plusTage(g.datum, 14),
        kundeName: kunde!.name,
        kundeZusatz: kunde!.zusatz,
        kundeStrasse: kunde!.strasse,
        kundePlz: kunde!.plz,
        kundeOrt: kunde!.ort,
        kundeLand: kunde!.land,
        netto: centToDecimal(g.nettoCent),
        ust: centToDecimal(g.ustCent),
        brutto: centToDecimal(g.bruttoCent),
        bezahltBetrag: centToDecimal(bezahltCent),
        bezahltAm: vollBezahlt ? g.datum : null,
        firmenSnapshot,
        bankSnapshot,
        bankAccountId: standardBank?.id ?? null,
        finalizedAt: new Date(),
        bemerkung: "Importiert aus Altbestand",
      })
      .$returningId();

    await db.insert(invoiceItems).values(
      g.items.map((it, i) => ({
        invoiceId: res.id,
        position: i + 1,
        bezeichnung: it.bezeichnung,
        menge: it.menge,
        einheit: it.einheit,
        einzelpreis: it.einzelpreis,
        ustSatz: it.ustSatz,
      })),
    );

    // Erst NACH erfolgreichem Insert den eigenen Kreis ggf. anheben (v1.2.2).
    try {
      await kreisAnhebenFallsEigenesFormat(g.nummer);
    } catch (e) {
      fehler.push(`${g.nummer}: Nummernkreis konnte nicht angehoben werden (${e instanceof Error ? e.message : String(e)})`);
    }

    importiert++;
  }

  return { importiert, uebersprungen, kundenNeu, fehler };
}
