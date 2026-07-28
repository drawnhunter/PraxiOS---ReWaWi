/** Einmalig: users-Tabelle + unique-Indizes auf Belegnummern nachziehen. */
import { getDb } from "./api/queries/connection";
import { sql } from "drizzle-orm";

const db = getDb();

await db.execute(sql`
  CREATE TABLE IF NOT EXISTS users (
    id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
    unionId varchar(255) NOT NULL,
    name varchar(255),
    email varchar(320),
    avatar text,
    role enum('user','admin') NOT NULL DEFAULT 'user',
    createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    lastSignInAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY users_unionId_unique (unionId)
  )
`);
console.log("users-Tabelle ok");

const tabellen = ["invoices", "credit_notes", "delivery_notes", "purchase_orders"] as const;
for (const t of tabellen) {
  const dup = await db.execute(sql.raw(
    `SELECT nummer, COUNT(*) c FROM ${t} WHERE nummer IS NOT NULL GROUP BY nummer HAVING c > 1`,
  ));
  const dupRows = (dup as unknown as [unknown[], unknown])[0];
  if (dupRows.length > 0) {
    console.log(`${t}: DUPLIKATE gefunden, Index wird NICHT angelegt:`, JSON.stringify(dupRows));
    continue;
  }
  const idx = await db.execute(sql.raw(
    `SELECT COUNT(*) c FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = '${t}' AND index_name = '${t}_nummer_unique'`,
  ));
  const vorhanden = Number((idx as unknown as [[{ c: number }], unknown])[0][0].c) > 0;
  if (!vorhanden) {
    await db.execute(sql.raw(`ALTER TABLE ${t} ADD UNIQUE KEY ${t}_nummer_unique (nummer)`));
    console.log(`${t}: unique-Index auf nummer angelegt`);
  } else {
    console.log(`${t}: Index existiert bereits`);
  }
}
process.exit(0);
