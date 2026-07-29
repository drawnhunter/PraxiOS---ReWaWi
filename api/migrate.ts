// Selbst-Migration beim Start: legt Spalten an, die aeltere Datenbanken
// noch nicht haben (idempotent — prueft erst information_schema).
// Frische Installationen kommen komplett aus schema.sql; diese Liste
// betrifft Bestandsdatenbanken aus aelteren Versionen.
import { sql } from "drizzle-orm";
import { getDb } from "./queries/connection";

const NEUE_SPALTEN: { tabelle: string; spalte: string; ddl: string }[] = [
  // Eigenes Login (Stufe 3)
  { tabelle: "users", spalte: "username", ddl: "ALTER TABLE users ADD COLUMN username VARCHAR(100) NULL AFTER unionId" },
  { tabelle: "users", spalte: "passwordHash", ddl: "ALTER TABLE users ADD COLUMN passwordHash VARCHAR(255) NULL AFTER username" },
  // Design-System (Stufe 4)
  { tabelle: "company_settings", spalte: "akzentfarbe", ddl: "ALTER TABLE company_settings ADD COLUMN akzentfarbe VARCHAR(30) NOT NULL DEFAULT 'neutral'" },
  { tabelle: "company_settings", spalte: "pdf_layout", ddl: "ALTER TABLE company_settings ADD COLUMN pdf_layout VARCHAR(30) NOT NULL DEFAULT 'klassisch'" },
  // EK/VK + Konditionen (Stufe 5)
  { tabelle: "products", spalte: "artikelnummer", ddl: "ALTER TABLE products ADD COLUMN artikelnummer VARCHAR(50) NULL AFTER name" },
  // Lagerbestand (Stufe 6)
  { tabelle: "products", spalte: "kategorie", ddl: "ALTER TABLE products ADD COLUMN kategorie VARCHAR(60) NULL" },
  { tabelle: "products", spalte: "barcode", ddl: "ALTER TABLE products ADD COLUMN barcode VARCHAR(60) NULL" },
  { tabelle: "products", spalte: "mindestbestand", ddl: "ALTER TABLE products ADD COLUMN mindestbestand DECIMAL(12,2) NULL" },
  { tabelle: "products", spalte: "lager_aktiv", ddl: "ALTER TABLE products ADD COLUMN lager_aktiv TINYINT(1) NOT NULL DEFAULT 0" },
  // E-Mail-Versand (SMTP)
  { tabelle: "company_settings", spalte: "smtp_host", ddl: "ALTER TABLE company_settings ADD COLUMN smtp_host VARCHAR(255) NULL" },
  { tabelle: "company_settings", spalte: "smtp_port", ddl: "ALTER TABLE company_settings ADD COLUMN smtp_port INT NOT NULL DEFAULT 587" },
  { tabelle: "company_settings", spalte: "smtp_user", ddl: "ALTER TABLE company_settings ADD COLUMN smtp_user VARCHAR(255) NULL" },
  { tabelle: "company_settings", spalte: "smtp_passwort_enc", ddl: "ALTER TABLE company_settings ADD COLUMN smtp_passwort_enc VARCHAR(500) NULL" },
  { tabelle: "company_settings", spalte: "smtp_absender", ddl: "ALTER TABLE company_settings ADD COLUMN smtp_absender VARCHAR(255) NULL" },
  { tabelle: "products", spalte: "ek_preis_netto", ddl: "ALTER TABLE products ADD COLUMN ek_preis_netto DECIMAL(12,2) NULL AFTER preis_netto" },
  // SupportHub-Verbindung (v1.1)
  { tabelle: "company_settings", spalte: "support_schluessel", ddl: "ALTER TABLE company_settings ADD COLUMN support_schluessel VARCHAR(80) NULL" },
  // ICS-Abo Zahlungsziele (v1.2)
  { tabelle: "company_settings", spalte: "ics_token", ddl: "ALTER TABLE company_settings ADD COLUMN ics_token VARCHAR(48) NULL" },
  // Kontierung Eingangsrechnungen (v1.2)
  { tabelle: "company_settings", spalte: "kreditor_startnummer", ddl: "ALTER TABLE company_settings ADD COLUMN kreditor_startnummer INT NOT NULL DEFAULT 70000" },
  { tabelle: "company_settings", spalte: "aufwandskonto_default", ddl: "ALTER TABLE company_settings ADD COLUMN aufwandskonto_default VARCHAR(10) NULL" },
  { tabelle: "incoming_invoices", spalte: "konto", ddl: "ALTER TABLE incoming_invoices ADD COLUMN konto VARCHAR(10) NULL" },
  { tabelle: "incoming_invoices", spalte: "gegenkonto", ddl: "ALTER TABLE incoming_invoices ADD COLUMN gegenkonto VARCHAR(10) NULL" },
];

const NEUE_TABELLEN: { tabelle: string; ddl: string }[] = [
  {
    tabelle: "invoice_series",
    ddl: `CREATE TABLE IF NOT EXISTS invoice_series (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      customer_id BIGINT UNSIGNED NOT NULL,
      titel VARCHAR(255) NOT NULL,
      intervall_tage INT NOT NULL DEFAULT 30,
      naechste_faellig DATE NOT NULL,
      items_json TEXT NOT NULL,
      bemerkung TEXT,
      aktiv TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX invoice_series_customer (customer_id),
      CONSTRAINT invoice_series_customer_fk FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
    )`,
  },
  {
    tabelle: "lager_bewegungen",
    ddl: `CREATE TABLE IF NOT EXISTS lager_bewegungen (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      product_id BIGINT UNSIGNED NOT NULL,
      typ ENUM('zugang','abgang','korrektur','inventur') NOT NULL,
      menge DECIMAL(12,2) NOT NULL,
      datum DATE NOT NULL,
      bemerkung VARCHAR(500),
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX lager_bewegungen_product (product_id),
      CONSTRAINT lager_bewegungen_product_fk FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    )`,
  },
  {
    tabelle: "incoming_invoices",
    ddl: `CREATE TABLE IF NOT EXISTS incoming_invoices (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      lieferant_name VARCHAR(255) NOT NULL,
      lieferant_kennung VARCHAR(255),
      nummer VARCHAR(100) NOT NULL,
      rechnungsdatum DATE NOT NULL,
      faelligkeitsdatum DATE,
      netto DECIMAL(12,2) NOT NULL,
      ust DECIMAL(12,2) NOT NULL,
      brutto DECIMAL(12,2) NOT NULL,
      waehrung VARCHAR(10) NOT NULL DEFAULT 'EUR',
      bezahlt_am DATE,
      positionen_json TEXT,
      original_xml MEDIUMTEXT,
      bemerkung TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE INDEX incoming_eindeutig (lieferant_name, nummer)
    )`,
  },
  {
    tabelle: "mail_log",
    ddl: `CREATE TABLE IF NOT EXISTS mail_log (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      beleg_art VARCHAR(30) NOT NULL,
      beleg_id BIGINT UNSIGNED NOT NULL,
      empfaenger VARCHAR(320) NOT NULL,
      betreff VARCHAR(500) NOT NULL,
      erfolg TINYINT(1) NOT NULL,
      fehler TEXT,
      gesendet_am TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX mail_log_beleg (beleg_art, beleg_id)
    )`,
  },
  {
    tabelle: "konditionen",
    ddl: `CREATE TABLE IF NOT EXISTS konditionen (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      typ ENUM('kunde','lieferant') NOT NULL,
      partner_id BIGINT UNSIGNED NOT NULL,
      product_id BIGINT UNSIGNED NOT NULL,
      preis_netto DECIMAL(12,2) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE INDEX konditionen_eindeutig (typ, partner_id, product_id),
      CONSTRAINT konditionen_product_fk FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    )`,
  },
  {
    tabelle: "support_meldungen",
    ddl: `CREATE TABLE IF NOT EXISTS support_meldungen (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      typ ENUM('frage','problem','idee','fehler') NOT NULL,
      betreff VARCHAR(200) NOT NULL,
      nachricht TEXT NOT NULL,
      kontext TEXT NULL,
      benutzer VARCHAR(255) NOT NULL,
      instanz VARCHAR(255) NOT NULL,
      version VARCHAR(20) NOT NULL,
      status ENUM('gesendet','fehlgeschlagen') NOT NULL,
      fehler VARCHAR(500) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  },
  {
    tabelle: "post_eingang",
    ddl: `CREATE TABLE IF NOT EXISTS post_eingang (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      typ ENUM('rechnung','sonstiges') NOT NULL DEFAULT 'rechnung',
      status ENUM('neu','gebucht','abgelegt') NOT NULL DEFAULT 'neu',
      originalname VARCHAR(255) NOT NULL,
      mime VARCHAR(100) NOT NULL,
      groesse INT NOT NULL,
      datei_inhalt MEDIUMTEXT NOT NULL,
      absender_lieferant_id BIGINT UNSIGNED NULL,
      absender_freitext VARCHAR(255) NULL,
      stichwort VARCHAR(255) NULL,
      rechnungsnummer VARCHAR(100) NULL,
      betrag DECIMAL(12,2) NULL,
      ust_satz INT NOT NULL DEFAULT 19,
      rechnungsdatum DATE NULL,
      faellig_am DATE NULL,
      wiedervorlage_am DATE NULL,
      konto VARCHAR(10) NULL,
      gegenkonto VARCHAR(10) NULL,
      kategorie_id BIGINT UNSIGNED NULL,
      quelle VARCHAR(120) NOT NULL DEFAULT 'upload',
      notizen TEXT NULL,
      incoming_invoice_id BIGINT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX post_eingang_lieferant (absender_lieferant_id),
      CONSTRAINT post_eingang_lieferant_fk FOREIGN KEY (absender_lieferant_id) REFERENCES suppliers(id) ON DELETE SET NULL,
      INDEX post_eingang_kategorie (kategorie_id),
      CONSTRAINT post_eingang_kategorie_fk FOREIGN KEY (kategorie_id) REFERENCES kategorien(id) ON DELETE SET NULL,
      INDEX post_eingang_eingang (incoming_invoice_id),
      CONSTRAINT post_eingang_eingang_fk FOREIGN KEY (incoming_invoice_id) REFERENCES incoming_invoices(id) ON DELETE SET NULL
    )`,
  },
  {
    tabelle: "email_konten",
    ddl: `CREATE TABLE IF NOT EXISTS email_konten (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      host VARCHAR(255) NOT NULL,
      port INT NOT NULL DEFAULT 993,
      tls TINYINT(1) NOT NULL DEFAULT 1,
      benutzer VARCHAR(255) NOT NULL,
      passwort_enc VARCHAR(500) NOT NULL,
      ordner VARCHAR(100) NOT NULL DEFAULT 'INBOX',
      route ENUM('rechnung','sonstiges') NOT NULL DEFAULT 'rechnung',
      intervall_minuten INT NOT NULL DEFAULT 10,
      aktiv TINYINT(1) NOT NULL DEFAULT 1,
      letzter_abruf TIMESTAMP NULL,
      letzter_fehler VARCHAR(500) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  },
  {
    tabelle: "kontenrahmen",
    ddl: `CREATE TABLE IF NOT EXISTS kontenrahmen (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      rahmen ENUM('SKR03','SKR04') NOT NULL,
      konto VARCHAR(10) NOT NULL,
      bezeichnung VARCHAR(255) NOT NULL,
      klasse INT NOT NULL,
      gruppe VARCHAR(120) NULL,
      UNIQUE INDEX kontenrahmen_eindeutig (rahmen, konto)
    )`,
  },
  {
    tabelle: "kategorien",
    ddl: `CREATE TABLE IF NOT EXISTS kategorien (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      konto VARCHAR(10) NULL,
      ust_satz INT NOT NULL DEFAULT 19,
      sortierung INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  },
];

const NEUE_INDIZES: { tabelle: string; index: string; ddl: string }[] = [
  { tabelle: "users", index: "users_username_unique", ddl: "ALTER TABLE users ADD UNIQUE INDEX users_username_unique (username)" },
];

export async function migriereFehlendeSpalten(): Promise<void> {
  const db = getDb();
  const dbName = new URL(process.env.DATABASE_URL!).pathname.replace(/^\//, "").split("?")[0];

  for (const s of NEUE_SPALTEN) {
    const [rows] = (await db.execute(
      sql.raw(
        `SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='${dbName}' AND TABLE_NAME='${s.tabelle}' AND COLUMN_NAME='${s.spalte}'`,
      ),
    )) as unknown as [{ n: number }[], unknown];
    if (Number(rows[0]?.n ?? 0) === 0) {
      console.log(`[migrate] + ${s.tabelle}.${s.spalte}`);
      await db.execute(sql.raw(s.ddl));
    }
  }

  for (const t of NEUE_TABELLEN) {
    const [rows] = (await db.execute(
      sql.raw(
        `SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA='${dbName}' AND TABLE_NAME='${t.tabelle}'`,
      ),
    )) as unknown as [{ n: number }[], unknown];
    if (Number(rows[0]?.n ?? 0) === 0) {
      console.log(`[migrate] + Tabelle ${t.tabelle}`);
      await db.execute(sql.raw(t.ddl));
    }
  }

  for (const i of NEUE_INDIZES) {
    const [rows] = (await db.execute(
      sql.raw(
        `SELECT COUNT(*) AS n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA='${dbName}' AND TABLE_NAME='${i.tabelle}' AND INDEX_NAME='${i.index}'`,
      ),
    )) as unknown as [{ n: number }[], unknown];
    if (Number(rows[0]?.n ?? 0) === 0) {
      console.log(`[migrate] + Index ${i.index}`);
      await db.execute(sql.raw(i.ddl));
    }
  }
}
