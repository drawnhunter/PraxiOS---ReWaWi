// Buchungskern fuer Eingangsrechnungen — wird vom einrechnungRouter,
// Magic Import und Post Manager (buchen) gemeinsam genutzt.
import { getDb } from "../queries/connection";
import { incomingInvoices } from "@db/schema";
import { analysiereXrechnung } from "../xrechnungEinlesen";

export async function duplikatEingangsrechnung(lieferant: string, nummer: string) {
  const treffer = await getDb().query.incomingInvoices.findFirst({
    where: (t, { eq: e, and: a }) => a(e(t.lieferantName, lieferant), e(t.nummer, nummer)),
  });
  return treffer ?? null;
}

/** Parst die XML und legt die Eingangsrechnung an. Wirft bei Fehlern/Duplikat. */
export async function bucheEingangsrechnungAusXml(
  xml: string,
): Promise<{ id: number; lieferant: string; nummer: string }> {
  const { daten, fehler } = analysiereXrechnung(xml);
  if (fehler.length > 0 || !daten) {
    throw new Error(`Keine buchbare E-Rechnung: ${fehler.join("; ")}`);
  }
  if (!daten.datum) throw new Error("Rechnungsdatum fehlt — kann nicht gebucht werden.");
  const dup = await duplikatEingangsrechnung(daten.lieferant, daten.nummer);
  if (dup) {
    throw new Error(`„${daten.nummer}“ von ${daten.lieferant} wurde bereits importiert.`);
  }
  const [res] = await getDb()
    .insert(incomingInvoices)
    .values({
      lieferantName: daten.lieferant,
      lieferantKennung: daten.lieferantKennung,
      nummer: daten.nummer,
      rechnungsdatum: daten.datum,
      faelligkeitsdatum: daten.faellig,
      netto: daten.netto.toFixed(2),
      ust: daten.ust.toFixed(2),
      brutto: daten.brutto.toFixed(2),
      waehrung: daten.waehrung,
      positionenJson: JSON.stringify(daten.positionen),
      originalXml: xml,
    })
    .$returningId();
  return { id: res.id, lieferant: daten.lieferant, nummer: daten.nummer };
}
