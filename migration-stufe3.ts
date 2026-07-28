/** Einmalig: Stufe 3 — reminders, offers, offer_items, DATEV-Felder, debitornummer. */
import { getDb } from "./api/queries/connection";
import { sql } from "drizzle-orm";

const db = getDb();

async function spalteFehlt(tabelle: string, spalte: string): Promise<boolean> {
  const r = await db.execute(sql.raw(
    `SELECT COUNT(*) c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = '${tabelle}' AND column_name = '${spalte}'`,
  ));
  return Number((r as unknown as [[{ c: number }], unknown])[0][0].c) === 0;
}

await db.execute(sql`
  CREATE TABLE IF NOT EXISTS reminders (
    id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
    invoice_id bigint unsigned NOT NULL,
    stufe int NOT NULL,
    datum date NOT NULL,
    zahlungsfrist date NOT NULL,
    offen_betrag decimal(12,2) NOT NULL,
    bemerkung text,
    created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY reminders_invoice_idx (invoice_id)
  )
`);
console.log("reminders ok");

await db.execute(sql`
  CREATE TABLE IF NOT EXISTS offers (
    id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
    nummer varchar(20) UNIQUE,
    status enum('entwurf','finalisiert','umgewandelt','storniert') NOT NULL DEFAULT 'entwurf',
    customer_id bigint unsigned NOT NULL,
    datum date NOT NULL,
    gueltig_bis date,
    kunde_name varchar(255) NOT NULL,
    kunde_zusatz varchar(255),
    kunde_strasse varchar(255) NOT NULL,
    kunde_plz varchar(20) NOT NULL,
    kunde_ort varchar(100) NOT NULL,
    kunde_land varchar(100) NOT NULL DEFAULT 'Deutschland',
    firmen_snapshot text,
    netto decimal(12,2) NOT NULL DEFAULT 0,
    ust decimal(12,2) NOT NULL DEFAULT 0,
    brutto decimal(12,2) NOT NULL DEFAULT 0,
    pdf_notiz text,
    bemerkung text,
    converted_invoice_id bigint unsigned,
    finalized_at timestamp NULL,
    created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY offers_status_idx (status)
  )
`);
console.log("offers ok");

await db.execute(sql`
  CREATE TABLE IF NOT EXISTS offer_items (
    id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
    offer_id bigint unsigned NOT NULL,
    position int NOT NULL,
    bezeichnung varchar(255) NOT NULL,
    beschreibung text,
    menge decimal(12,3) NOT NULL,
    einheit varchar(30) NOT NULL DEFAULT 'Stück',
    einzelpreis decimal(12,2) NOT NULL,
    ust_satz int NOT NULL DEFAULT 19,
    KEY offer_items_offer_idx (offer_id)
  )
`);
console.log("offer_items ok");

const datevSpalten: [string, string][] = [
  ["datev_beraternummer", "varchar(20)"],
  ["datev_mandantennummer", "varchar(20)"],
  ["datev_kontenrahmen", "varchar(10) NOT NULL DEFAULT 'SKR03'"],
  ["erloeskonto_19", "varchar(10) NOT NULL DEFAULT '8400'"],
  ["erloeskonto_7", "varchar(10) NOT NULL DEFAULT '8300'"],
  ["erloeskonto_0", "varchar(10) NOT NULL DEFAULT '8120'"],
  ["debitor_startnummer", "int NOT NULL DEFAULT 10000"],
];
for (const [spalte, typ] of datevSpalten) {
  if (await spalteFehlt("company_settings", spalte)) {
    await db.execute(sql.raw(`ALTER TABLE company_settings ADD COLUMN ${spalte} ${typ}`));
    console.log(`company_settings.${spalte} hinzugefügt`);
  }
}
if (await spalteFehlt("customers", "debitornummer")) {
  await db.execute(sql.raw(`ALTER TABLE customers ADD COLUMN debitornummer int`));
  console.log("customers.debitornummer hinzugefügt");
}
process.exit(0);
