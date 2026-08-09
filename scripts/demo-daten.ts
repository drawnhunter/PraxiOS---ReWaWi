// Demo-Daten zum Ausprobieren (kein Produktivbetrieb!).
// Ausfuehren: npx tsx scripts/demo-daten.ts
import { getDb } from "../api/queries/connection";
import { customers, products, suppliers } from "../db/schema";

const db = getDb();
const kunden = await db.select().from(customers);
if (kunden.length > 0) {
  console.log("Es existieren bereits Kunden — Demo-Daten werden NICHT angelegt (Schutz vor Dopplern).");
  process.exit(0);
}

await db.insert(customers).values([
  { name: "Muster GmbH", strasse: "Hauptstraße 12", plz: "10115", ort: "Berlin", land: "Deutschland", email: "buchhaltung@muster.example" },
  { name: "Dr. Beispielpraxis", strasse: "Am Markt 3", plz: "14480", ort: "Potsdam", land: "Deutschland", email: "praxis@beispiel.example" },
  { name: "Kleinhandel Schulz", strasse: "Gartenweg 7", plz: "20354", ort: "Hamburg", land: "Deutschland" },
]);
await db.insert(products).values([
  { name: "Beratung (Stunde)", einheit: "Stunde", preisNetto: "95.00", ekPreisNetto: "0", ustSatz: 19, kategorie: "Dienstleistungen" },
  { name: "Wartungspaket (Monat)", einheit: "Monat", preisNetto: "149.00", ekPreisNetto: "60.00", ustSatz: 19, kategorie: "Dienstleistungen" },
  { name: "Filterpatrone Standard", artikelnummer: "FT-100", einheit: "Stück", preisNetto: "24.90", ekPreisNetto: "12.50", ustSatz: 19, kategorie: "Einmalmaterial", lagerAktiv: true },
  { name: "Spezialöl 1l", artikelnummer: "OEL-1", einheit: "Flasche", preisNetto: "39.90", ekPreisNetto: "18.00", ustSatz: 19, kategorie: "Verbrauchsmaterial", lagerAktiv: true },
  { name: "Handbuch gedruckt", einheit: "Stück", preisNetto: "9.90", ekPreisNetto: "3.50", ustSatz: 7, kategorie: "Sonstiges" },
]);
await db.insert(suppliers).values([
  { name: "Musterlieferant AG", strasse: "Industriering 44", plz: "50667", ort: "Köln", land: "Deutschland", email: "sales@musterlieferant.example" },
]);
console.log("Demo-Daten angelegt: 3 Kunden, 5 Produkte, 1 Lieferant.");
process.exit(0);
