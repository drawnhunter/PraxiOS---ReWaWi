// Selbst-Migration beim Start: legt Spalten an, die aeltere Datenbanken
// noch nicht haben (idempotent — prueft erst information_schema).
// Frische Installationen kommen komplett aus schema.sql; diese Liste
// betrifft Bestandsdatenbanken aus aelteren Versionen.
//
// v1.2.2:
// - Reihenfolge der Tabellen korrigiert: post_eingang hat einen FK auf
//   kategorien und muss daher NACH kategorien/kontenrahmen/email_konten
//   kommen (vorher brach die Migration auf Bestands-DBs ab → email_konten,
//   kontenrahmen, kategorien fehlten danach komplett).
// - Jeder Schritt laeuft jetzt in eigenem try/catch: ein fehlgeschlagener
//   Schritt blockiert nie mehr die restlichen.
import { sql } from "drizzle-orm";
import { getDb } from "./queries/connection";

// Exportiert für den statischen Ordnungs-Wachtest (api/migrate.test.ts)
export const NEUE_SPALTEN: { tabelle: string; spalte: string; ddl: string }[] = [
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
  // v1.6: Company Control + Archivieren + Regelwerk
  { tabelle: "company_settings", spalte: "eori", ddl: "ALTER TABLE company_settings ADD COLUMN eori VARCHAR(30) NULL" },
  { tabelle: "company_settings", spalte: "betriebsnummer", ddl: "ALTER TABLE company_settings ADD COLUMN betriebsnummer VARCHAR(30) NULL" },
  { tabelle: "company_settings", spalte: "bg_mitgliedsnummer", ddl: "ALTER TABLE company_settings ADD COLUMN bg_mitgliedsnummer VARCHAR(50) NULL" },
  { tabelle: "company_settings", spalte: "ihk", ddl: "ALTER TABLE company_settings ADD COLUMN ihk VARCHAR(60) NULL" },
  { tabelle: "company_settings", spalte: "glaeubiger_id", ddl: "ALTER TABLE company_settings ADD COLUMN glaeubiger_id VARCHAR(30) NULL" },
  { tabelle: "invoices", spalte: "archiviert", ddl: "ALTER TABLE invoices ADD COLUMN archiviert TINYINT(1) NOT NULL DEFAULT 0" },
  { tabelle: "suppliers", spalte: "kategorie_id", ddl: "ALTER TABLE suppliers ADD COLUMN kategorie_id BIGINT UNSIGNED NULL, ADD INDEX suppliers_kategorie (kategorie_id), ADD CONSTRAINT suppliers_kategorie_fk FOREIGN KEY (kategorie_id) REFERENCES kategorien(id) ON DELETE SET NULL" },
  { tabelle: "invoice_items", spalte: "rabatt_art", ddl: "ALTER TABLE invoice_items ADD COLUMN rabatt_art VARCHAR(10) NULL AFTER ust_satz" },
  { tabelle: "invoice_items", spalte: "rabatt_wert", ddl: "ALTER TABLE invoice_items ADD COLUMN rabatt_wert DECIMAL(12,2) NULL AFTER rabatt_art" },
  { tabelle: "invoices", spalte: "hauptrabatt_art", ddl: "ALTER TABLE invoices ADD COLUMN hauptrabatt_art VARCHAR(10) NULL AFTER brutto" },
  { tabelle: "invoices", spalte: "hauptrabatt_wert", ddl: "ALTER TABLE invoices ADD COLUMN hauptrabatt_wert DECIMAL(12,2) NULL AFTER hauptrabatt_art" },
  { tabelle: "invoices", spalte: "rabatt_addieren", ddl: "ALTER TABLE invoices ADD COLUMN rabatt_addieren TINYINT(1) NOT NULL DEFAULT 0 AFTER hauptrabatt_wert" },
  { tabelle: "company_settings", spalte: "waehrung", ddl: "ALTER TABLE company_settings ADD COLUMN waehrung VARCHAR(10) NOT NULL DEFAULT '€' AFTER ust_id_nr" },
  { tabelle: "company_settings", spalte: "monats_budget", ddl: "ALTER TABLE company_settings ADD COLUMN monats_budget DECIMAL(12,2) NULL AFTER waehrung" },
  { tabelle: "company_settings", spalte: "backup_zuletzt_am", ddl: "ALTER TABLE company_settings ADD COLUMN backup_zuletzt_am DATETIME NULL AFTER support_schluessel" },
  { tabelle: "bank_transaktionen", spalte: "quell_id", ddl: "ALTER TABLE bank_transaktionen ADD COLUMN quell_id VARCHAR(40) NULL AFTER hash, ADD INDEX bank_tx_quell_idx (quell_id)" },
  { tabelle: "company_settings", spalte: "agent_autonomie", ddl: "ALTER TABLE company_settings ADD COLUMN agent_autonomie VARCHAR(20) NOT NULL DEFAULT 'vorschlag' AFTER support_schluessel" },
  { tabelle: "company_settings", spalte: "modul_konfig", ddl: "ALTER TABLE company_settings ADD COLUMN modul_konfig TEXT NULL AFTER agent_autonomie" },
  { tabelle: "bank_transaktionen", spalte: "kategorie_id", ddl: "ALTER TABLE bank_transaktionen ADD COLUMN kategorie_id BIGINT UNSIGNED NULL AFTER quell_id, ADD INDEX bank_tx_kategorie_idx (kategorie_id)" },
  { tabelle: "kategorien", spalte: "typ", ddl: "ALTER TABLE kategorien ADD COLUMN typ VARCHAR(10) NOT NULL DEFAULT 'ausgabe' AFTER konto" },
  { tabelle: "company_settings", spalte: "bank_konto", ddl: "ALTER TABLE company_settings ADD COLUMN bank_konto VARCHAR(10) NOT NULL DEFAULT '1200' AFTER monats_budget" },
  { tabelle: "customers", spalte: "synonym", ddl: "ALTER TABLE customers ADD COLUMN synonym VARCHAR(12) NULL AFTER name" },
  { tabelle: "suppliers", spalte: "synonym", ddl: "ALTER TABLE suppliers ADD COLUMN synonym VARCHAR(12) NULL AFTER name" },
  { tabelle: "company_settings", spalte: "agent_pseudonym", ddl: "ALTER TABLE company_settings ADD COLUMN agent_pseudonym TINYINT(1) NOT NULL DEFAULT 1 AFTER bank_konto" },
  { tabelle: "company_settings", spalte: "signatur", ddl: "ALTER TABLE company_settings ADD COLUMN signatur TEXT NULL AFTER smtp_absender" },
  { tabelle: "email_konten", spalte: "ordner_liste", ddl: "ALTER TABLE email_konten ADD COLUMN ordner_liste TEXT NULL AFTER ordner" },
  { tabelle: "email_konten", spalte: "smtp_host", ddl: "ALTER TABLE email_konten ADD COLUMN smtp_host VARCHAR(255) NULL" },
  { tabelle: "email_konten", spalte: "smtp_port", ddl: "ALTER TABLE email_konten ADD COLUMN smtp_port INT NULL" },
  { tabelle: "email_konten", spalte: "smtp_benutzer", ddl: "ALTER TABLE email_konten ADD COLUMN smtp_benutzer VARCHAR(255) NULL" },
  { tabelle: "email_konten", spalte: "smtp_passwort_enc", ddl: "ALTER TABLE email_konten ADD COLUMN smtp_passwort_enc VARCHAR(500) NULL" },
  { tabelle: "email_konten", spalte: "smtp_absender", ddl: "ALTER TABLE email_konten ADD COLUMN smtp_absender VARCHAR(255) NULL" },
  { tabelle: "users", spalte: "mail_konto_ids", ddl: "ALTER TABLE users ADD COLUMN mail_konto_ids TEXT NULL" },
  { tabelle: "mail_entwuerfe", spalte: "bcc", ddl: "ALTER TABLE mail_entwuerfe ADD COLUMN bcc VARCHAR(500) NULL AFTER cc" },
  { tabelle: "mail_entwuerfe", spalte: "konto_id", ddl: "ALTER TABLE mail_entwuerfe ADD COLUMN konto_id BIGINT UNSIGNED NULL AFTER bcc" },
  { tabelle: "incoming_invoices", spalte: "kategorie_id", ddl: "ALTER TABLE incoming_invoices ADD COLUMN kategorie_id BIGINT UNSIGNED NULL AFTER gegenkonto, ADD INDEX incoming_kategorie_idx (kategorie_id)" },
  { tabelle: "incoming_invoices", spalte: "beleg_base64", ddl: "ALTER TABLE incoming_invoices ADD COLUMN beleg_base64 MEDIUMTEXT NULL AFTER kategorie_id" },
  { tabelle: "incoming_invoices", spalte: "beleg_mime", ddl: "ALTER TABLE incoming_invoices ADD COLUMN beleg_mime VARCHAR(60) NULL AFTER beleg_base64" },
  // ── v1.17.0: Agent-API Ausbau ──
  { tabelle: "mail_entwuerfe", spalte: "anhaenge", ddl: "ALTER TABLE mail_entwuerfe ADD COLUMN anhaenge MEDIUMTEXT NULL AFTER text" },
  { tabelle: "mail_entwuerfe", spalte: "in_reply_to", ddl: "ALTER TABLE mail_entwuerfe ADD COLUMN in_reply_to VARCHAR(500) NULL AFTER anhaenge" },
  { tabelle: "mail_entwuerfe", spalte: "referenzen", ddl: "ALTER TABLE mail_entwuerfe ADD COLUMN referenzen VARCHAR(1000) NULL AFTER in_reply_to" },
  { tabelle: "mail_entwuerfe", spalte: "quelle", ddl: "ALTER TABLE mail_entwuerfe ADD COLUMN quelle VARCHAR(20) NOT NULL DEFAULT 'mensch' AFTER referenzen" },
  { tabelle: "agent_tokens", spalte: "freigabe_empfaenger", ddl: "ALTER TABLE agent_tokens ADD COLUMN freigabe_empfaenger TEXT NULL AFTER aktiv" },
  { tabelle: "agent_aufgaben", spalte: "faellig_am", ddl: "ALTER TABLE agent_aufgaben ADD COLUMN faellig_am DATE NULL AFTER erledigt_am" },
  { tabelle: "agent_aufgaben", spalte: "prioritaet", ddl: "ALTER TABLE agent_aufgaben ADD COLUMN prioritaet VARCHAR(10) NOT NULL DEFAULT 'normal' AFTER faellig_am" },
  { tabelle: "agent_aufgaben", spalte: "referenz_json", ddl: "ALTER TABLE agent_aufgaben ADD COLUMN referenz_json TEXT NULL AFTER prioritaet" },
  { tabelle: "termine", spalte: "kunden_id", ddl: "ALTER TABLE termine ADD COLUMN kunden_id BIGINT UNSIGNED NULL AFTER mail_id" },
  { tabelle: "termine", spalte: "erinnere_am", ddl: "ALTER TABLE termine ADD COLUMN erinnere_am DATETIME NULL AFTER kunden_id" },
  { tabelle: "termine", spalte: "serie", ddl: "ALTER TABLE termine ADD COLUMN serie VARCHAR(20) NULL AFTER erinnere_am" },
  { tabelle: "termine", spalte: "serie_id", ddl: "ALTER TABLE termine ADD COLUMN serie_id VARCHAR(36) NULL AFTER serie" },
  // ── v1.18.0: Kanzlei-Release ──
  { tabelle: "mail_entwuerfe", spalte: "status", ddl: "ALTER TABLE mail_entwuerfe ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'entwurf' AFTER quelle" },
  { tabelle: "mail_entwuerfe", spalte: "versand_versuch_am", ddl: "ALTER TABLE mail_entwuerfe ADD COLUMN versand_versuch_am DATETIME NULL AFTER status" },
  { tabelle: "mail_entwuerfe", spalte: "versand_fehler", ddl: "ALTER TABLE mail_entwuerfe ADD COLUMN versand_fehler TEXT NULL AFTER versand_versuch_am" },
  { tabelle: "company_settings", spalte: "steuerberater_email", ddl: "ALTER TABLE company_settings ADD COLUMN steuerberater_email VARCHAR(320) NULL AFTER signatur" },
  // ── v1.19.0: Kanzlei-Arbeitsplatz + Eingangsseite ──
  { tabelle: "incoming_invoices", spalte: "freigabe", ddl: "ALTER TABLE incoming_invoices ADD COLUMN freigabe VARCHAR(20) NOT NULL DEFAULT 'neu' AFTER beleg_mime" },
  { tabelle: "incoming_invoices", spalte: "freigegeben_am", ddl: "ALTER TABLE incoming_invoices ADD COLUMN freigegeben_am DATETIME NULL AFTER freigabe" },
  { tabelle: "incoming_invoices", spalte: "freigegeben_von", ddl: "ALTER TABLE incoming_invoices ADD COLUMN freigegeben_von VARCHAR(100) NULL AFTER freigegeben_am" },
  { tabelle: "mail_mails", spalte: "markiert", ddl: "ALTER TABLE mail_mails ADD COLUMN markiert TINYINT(1) NOT NULL DEFAULT 0 AFTER gelesen" },
  { tabelle: "incoming_invoices", spalte: "typ", ddl: "ALTER TABLE incoming_invoices ADD COLUMN typ VARCHAR(20) NOT NULL DEFAULT 'rechnung' AFTER waehrung" },
  { tabelle: "incoming_invoices", spalte: "betrag_bank", ddl: "ALTER TABLE incoming_invoices ADD COLUMN betrag_bank DECIMAL(12,2) NULL AFTER waehrung" },
  // ── v1.20.0: Mail-Pro + Editor ──
  { tabelle: "email_konten", spalte: "signatur_neu", ddl: "ALTER TABLE email_konten ADD COLUMN signatur_neu TEXT NULL AFTER smtp_absender" },
  { tabelle: "email_konten", spalte: "signatur_antwort", ddl: "ALTER TABLE email_konten ADD COLUMN signatur_antwort TEXT NULL AFTER signatur_neu" },
  { tabelle: "email_konten", spalte: "abwesenheit_aktiv", ddl: "ALTER TABLE email_konten ADD COLUMN abwesenheit_aktiv TINYINT(1) NOT NULL DEFAULT 0 AFTER signatur_antwort" },
  { tabelle: "email_konten", spalte: "abwesenheit_von", ddl: "ALTER TABLE email_konten ADD COLUMN abwesenheit_von VARCHAR(10) NULL AFTER abwesenheit_aktiv" },
  { tabelle: "email_konten", spalte: "abwesenheit_bis", ddl: "ALTER TABLE email_konten ADD COLUMN abwesenheit_bis VARCHAR(10) NULL AFTER abwesenheit_von" },
  { tabelle: "email_konten", spalte: "abwesenheit_text", ddl: "ALTER TABLE email_konten ADD COLUMN abwesenheit_text TEXT NULL AFTER abwesenheit_bis" },
  { tabelle: "email_konten", spalte: "abwesenheit_nur_kontakte", ddl: "ALTER TABLE email_konten ADD COLUMN abwesenheit_nur_kontakte TINYINT(1) NOT NULL DEFAULT 0 AFTER abwesenheit_text" },
  { tabelle: "mail_entwuerfe", spalte: "geplantes_senden_am", ddl: "ALTER TABLE mail_entwuerfe ADD COLUMN geplantes_senden_am DATETIME NULL AFTER versand_fehler" },
  { tabelle: "company_settings", spalte: "typo_korrektur", ddl: "ALTER TABLE company_settings ADD COLUMN typo_korrektur TINYINT(1) NOT NULL DEFAULT 1 AFTER steuerberater_email" },
  { tabelle: "company_settings", spalte: "undo_sende_sekunden", ddl: "ALTER TABLE company_settings ADD COLUMN undo_sende_sekunden INT NOT NULL DEFAULT 0 AFTER typo_korrektur" },
];

// WICHTIG: Tabellen ohne Fremdschluessel-Abhaengigkeiten zuerst.
// post_eingang referenziert kategorien, suppliers und incoming_invoices
// und muss daher am Ende stehen.
const NEUE_TABELLEN: { tabelle: string; ddl: string }[] = [
  {
    tabelle: "agent_tokens",
    ddl: `CREATE TABLE IF NOT EXISTS agent_tokens (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      token_hash VARCHAR(64) NOT NULL,
      aktiv TINYINT(1) NOT NULL DEFAULT 1,
      letzte_nutzung DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX agent_tokens_hash (token_hash)
    )`,
  },
  {
    tabelle: "agent_aufgaben",
    ddl: `CREATE TABLE IF NOT EXISTS agent_aufgaben (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      text VARCHAR(500) NOT NULL,
      erledigt TINYINT(1) NOT NULL DEFAULT 0,
      erledigt_am DATETIME NULL,
      quelle VARCHAR(20) NOT NULL DEFAULT 'mensch',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  },
  {
    tabelle: "agent_log",
    ddl: `CREATE TABLE IF NOT EXISTS agent_log (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      aktion VARCHAR(100) NOT NULL,
      details TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  },
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
  // ── v1.2-Tabellen ohne FK-Abhaengigkeiten (vor post_eingang!) ──
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
  {
    tabelle: "termine",
    ddl: `CREATE TABLE IF NOT EXISTS termine (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      datum DATE NOT NULL,
      start_zeit VARCHAR(5) NULL,
      end_zeit VARCHAR(5) NULL,
      titel VARCHAR(255) NOT NULL,
      beschreibung TEXT NULL,
      farbe VARCHAR(12) NULL,
      quelle VARCHAR(40) NOT NULL DEFAULT 'manuell',
      mail_id BIGINT UNSIGNED NULL,
      erstellt_von VARCHAR(40) NOT NULL DEFAULT 'mensch',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX termine_datum (datum)
    )`,
  },
  {
    tabelle: "kontakte",
    ddl: `CREATE TABLE IF NOT EXISTS kontakte (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(320) NOT NULL,
      telefon VARCHAR(60) NULL,
      firma VARCHAR(255) NULL,
      notiz TEXT NULL,
      quelle VARCHAR(40) NOT NULL DEFAULT 'manuell',
      erstellt_von VARCHAR(40) NOT NULL DEFAULT 'mensch',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY kontakte_email_uniq (email)
    )`,
  },
  {
    tabelle: "mail_regeln",
    ddl: `CREATE TABLE IF NOT EXISTS mail_regeln (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      pattern VARCHAR(500) NOT NULL,
      feld ENUM('absender','betreff') NOT NULL DEFAULT 'absender',
      post_typ ENUM('rechnung','sonstiges') NOT NULL DEFAULT 'rechnung',
      kategorie_id BIGINT UNSIGNED NULL,
      prio INT NOT NULL DEFAULT 10,
      aktiv TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX mail_regeln_prio (prio)
    )`,
  },
  {
    tabelle: "mail_entwuerfe",
    ddl: `CREATE TABLE IF NOT EXISTS mail_entwuerfe (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      empfaenger VARCHAR(500) NULL,
      cc VARCHAR(500) NULL,
      betreff VARCHAR(500) NULL,
      text MEDIUMTEXT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  },
  {
    tabelle: "mail_mails",
    ddl: `CREATE TABLE IF NOT EXISTS mail_mails (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      konto_id BIGINT UNSIGNED NOT NULL,
      ordner VARCHAR(100) NOT NULL DEFAULT 'INBOX',
      uid BIGINT UNSIGNED NOT NULL,
      message_id VARCHAR(255) NULL,
      betreff VARCHAR(500) NULL,
      absender_name VARCHAR(255) NULL,
      absender_adresse VARCHAR(320) NULL,
      empfaenger TEXT NULL,
      datum DATETIME NULL,
      text_plain MEDIUMTEXT NULL,
      text_html MEDIUMTEXT NULL,
      anhaenge TEXT NULL,
      gelesen TINYINT(1) NOT NULL DEFAULT 0,
      markiert TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY mail_eindeutig (konto_id, ordner, uid),
      INDEX mail_datum_idx (datum),
      CONSTRAINT mail_mails_konto_fk FOREIGN KEY (konto_id) REFERENCES email_konten(id) ON DELETE CASCADE
    )`,
  },
  {
    tabelle: "bank_regeln",
    ddl: `CREATE TABLE IF NOT EXISTS bank_regeln (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      kategorie_id BIGINT UNSIGNED NOT NULL,
      pattern VARCHAR(500) NOT NULL,
      feld ENUM('name','zweck') NOT NULL DEFAULT 'name',
      prio INT NOT NULL DEFAULT 10,
      aktiv TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX bank_regeln_kategorie (kategorie_id),
      CONSTRAINT bank_regeln_kategorie_fk FOREIGN KEY (kategorie_id) REFERENCES kategorien(id) ON DELETE CASCADE
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
  // v1.6: Company Control — freie Kennwerte
  {
    tabelle: "company_kennwerte",
    ddl: `CREATE TABLE IF NOT EXISTS company_kennwerte (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      wert VARCHAR(255) NOT NULL,
      post_eingang_id BIGINT UNSIGNED NULL,
      sortierung INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX company_kennwerte_beleg (post_eingang_id),
      CONSTRAINT company_kennwerte_beleg_fk FOREIGN KEY (post_eingang_id) REFERENCES post_eingang(id) ON DELETE SET NULL
    )`,
  },
  // v1.7: Zeiterfassung — erst mitarbeiter, dann Eintraege (FK-Reihenfolge)
  {
    tabelle: "mitarbeiter",
    ddl: `CREATE TABLE IF NOT EXISTS mitarbeiter (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      farbe VARCHAR(7) NOT NULL DEFAULT '#0f766e',
      stundensatz DECIMAL(8,2) NULL,
      aktiv TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  },
  {
    tabelle: "zeiteintraege",
    ddl: `CREATE TABLE IF NOT EXISTS zeiteintraege (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      mitarbeiter_id BIGINT UNSIGNED NOT NULL,
      customer_id BIGINT UNSIGNED NULL,
      von TIMESTAMP NOT NULL,
      bis TIMESTAMP NULL,
      notiz VARCHAR(255) NULL,
      quelle ENUM('stempel','manuell') NOT NULL DEFAULT 'stempel',
      gesperrt TINYINT(1) NOT NULL DEFAULT 0,
      invoice_id BIGINT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX zeiteintraege_mitarbeiter (mitarbeiter_id),
      INDEX zeiteintraege_kunde (customer_id),
      INDEX zeiteintraege_rechnung (invoice_id),
      INDEX zeiteintraege_von (von),
      CONSTRAINT zeiteintraege_mitarbeiter_fk FOREIGN KEY (mitarbeiter_id) REFERENCES mitarbeiter(id) ON DELETE CASCADE,
      CONSTRAINT zeiteintraege_kunde_fk FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
      CONSTRAINT zeiteintraege_rechnung_fk FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL
    )`,
  },
  // ── zuletzt: hat FKs auf kategorien, suppliers, incoming_invoices ──
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
  // ── v1.3: Banking — erst die Import-Chargen, dann die Transaktionen (FK) ──
  {
    tabelle: "bank_importe",
    ddl: `CREATE TABLE IF NOT EXISTS bank_importe (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      bank_account_id BIGINT UNSIGNED NOT NULL,
      dateiname VARCHAR(255) NOT NULL,
      vorlage VARCHAR(60) NOT NULL DEFAULT 'Bank-CSV',
      zeilen INT NOT NULL DEFAULT 0,
      duplikate INT NOT NULL DEFAULT 0,
      summe_ein DECIMAL(14,2) NOT NULL DEFAULT 0,
      summe_aus DECIMAL(14,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX bank_importe_konto (bank_account_id),
      CONSTRAINT bank_importe_konto_fk FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id) ON DELETE CASCADE
    )`,
  },
  {
    tabelle: "bank_transaktionen",
    ddl: `CREATE TABLE IF NOT EXISTS bank_transaktionen (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      bank_account_id BIGINT UNSIGNED NOT NULL,
      import_id BIGINT UNSIGNED NULL,
      datum DATE NOT NULL,
      name VARCHAR(255) NOT NULL DEFAULT '',
      zweck TEXT NULL,
      betrag DECIMAL(14,2) NOT NULL,
      gebuehr DECIMAL(12,2) NULL,
      saldo_nach DECIMAL(14,2) NULL,
      hash VARCHAR(64) NOT NULL,
      status ENUM('offen','zugeordnet','ignoriert') NOT NULL DEFAULT 'offen',
      invoice_id BIGINT UNSIGNED NULL,
      incoming_invoice_id BIGINT UNSIGNED NULL,
      zugeordneter_betrag DECIMAL(14,2) NULL,
      zugeordnet_am TIMESTAMP NULL,
      bemerkung VARCHAR(500) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE INDEX bank_tx_hash_uniq (bank_account_id, hash),
      INDEX bank_tx_konto_datum (bank_account_id, datum),
      INDEX bank_tx_status (status),
      INDEX bank_tx_invoice (invoice_id),
      INDEX bank_tx_incoming (incoming_invoice_id),
      CONSTRAINT bank_tx_konto_fk FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id) ON DELETE CASCADE,
      CONSTRAINT bank_tx_import_fk FOREIGN KEY (import_id) REFERENCES bank_importe(id) ON DELETE SET NULL,
      CONSTRAINT bank_tx_invoice_fk FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL,
      CONSTRAINT bank_tx_incoming_fk FOREIGN KEY (incoming_invoice_id) REFERENCES incoming_invoices(id) ON DELETE SET NULL
    )`,
  },
  // ── v1.17.0 ──
  {
    tabelle: "agent_idempotenz",
    ddl: `CREATE TABLE IF NOT EXISTS agent_idempotenz (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      schluessel VARCHAR(128) NOT NULL,
      endpunkt VARCHAR(255) NOT NULL,
      status INT NOT NULL,
      antwort_json MEDIUMTEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE INDEX agent_idem_key (schluessel)
    )`,
  },
  {
    tabelle: "webhooks",
    ddl: `CREATE TABLE IF NOT EXISTS webhooks (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      ereignis VARCHAR(40) NOT NULL,
      url VARCHAR(1000) NOT NULL,
      aktiv TINYINT(1) NOT NULL DEFAULT 1,
      fehler INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX webhooks_ereignis (ereignis, aktiv)
    )`,
  },
  // ── v1.19.0: Kanzlei-Arbeitsplatz ──
  {
    tabelle: "beleg_klaerungen",
    ddl: `CREATE TABLE IF NOT EXISTS beleg_klaerungen (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      incoming_invoice_id BIGINT UNSIGNED NOT NULL,
      frage TEXT NOT NULL,
      antwort TEXT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'offen',
      frage_von VARCHAR(100) NOT NULL,
      antwort_von VARCHAR(100) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE INDEX klaerung_beleg (incoming_invoice_id),
      INDEX klaerung_status (status)
    )`,
  },
  {
    tabelle: "kanzlei_log",
    ddl: `CREATE TABLE IF NOT EXISTS kanzlei_log (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NULL,
      benutzername VARCHAR(100) NULL,
      pfad VARCHAR(255) NOT NULL,
      erstellt_am TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX kanzlei_log_user (user_id, erstellt_am)
    )`,
  },
  // ── v1.20.0 ──
  {
    tabelle: "mail_bausteine",
    ddl: `CREATE TABLE IF NOT EXISTS mail_bausteine (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      kuerzel VARCHAR(40) NOT NULL,
      titel VARCHAR(120) NOT NULL,
      inhalt MEDIUMTEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE INDEX baustein_kuerzel (kuerzel)
    )`,
  },
  {
    tabelle: "mail_autoreply_log",
    ddl: `CREATE TABLE IF NOT EXISTS mail_autoreply_log (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      konto_id BIGINT UNSIGNED NOT NULL,
      absender VARCHAR(320) NOT NULL,
      gesendet_am TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX autoreply_dedup (konto_id, absender, gesendet_am)
    )`,
  },
];

// Struktur-Updates an BESTEHENDEN Tabellen (idempotent per Marker-Check).
// check: SQL das einen Wert liefert, wenn das Update NICHT noetig ist.
const SCHEMA_UPDATES: { name: string; check: (db: string) => string; ddl: string }[] = [
  {
    // v1.4: Belegtyp um lieferschein/gutschrift erweitern
    name: "post_eingang.typ + lieferschein/gutschrift",
    check: (db) =>
      `SELECT COLUMN_TYPE AS v FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='${db}' AND TABLE_NAME='post_eingang' AND COLUMN_NAME='typ' AND COLUMN_TYPE LIKE '%lieferschein%'`,
    ddl: "ALTER TABLE post_eingang MODIFY typ ENUM('rechnung','lieferschein','gutschrift','sonstiges') NOT NULL DEFAULT 'rechnung'",
  },
  {
    // v1.8 Schritt 1: Angebots-Status um offen/bestaetigt/abgelehnt erweitern
    // (Union-Enum, damit Bestandsdaten 'finalisiert' gueltig bleiben)
    name: "offers.status Enum erweitern",
    check: (db) =>
      `SELECT COLUMN_TYPE AS v FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='${db}' AND TABLE_NAME='offers' AND COLUMN_NAME='status' AND COLUMN_TYPE LIKE '%offen%'`,
    ddl: "ALTER TABLE offers MODIFY status ENUM('entwurf','finalisiert','offen','bestaetigt','abgelehnt','umgewandelt','storniert') NOT NULL DEFAULT 'entwurf'",
  },
  {
    // v1.8 Schritt 2: Bestandsdaten finalisiert → offen
    name: "offers.status finalisiert→offen",
    check: (db) =>
      `SELECT COLUMN_TYPE AS v FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='${db}' AND TABLE_NAME='offers' AND COLUMN_NAME='status' AND COLUMN_TYPE NOT LIKE '%finalisiert%'`,
    ddl: "UPDATE offers SET status='offen' WHERE status='finalisiert'",
  },
  {
    // v1.19: users.role um 'kanzlei' erweitern (Kanzlei-Arbeitsplatz)
    name: "users.role Enum + kanzlei",
    check: (db) =>
      `SELECT COLUMN_TYPE AS v FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='${db}' AND TABLE_NAME='users' AND COLUMN_NAME='role' AND COLUMN_TYPE LIKE '%kanzlei%'`,
    ddl: "ALTER TABLE users MODIFY role ENUM('user','admin','kanzlei') NOT NULL DEFAULT 'user'",
  },
  {
    // v1.13: Synonyme fuer bestehende Kunden/Lieferanten nachziehen (DSGVO-Pseudonymisierung)
    name: "synonyme backfill customers",
    check: (db) =>
      `SELECT COUNT(*) AS v FROM customers WHERE synonym IS NULL`,
    ddl: "UPDATE customers SET synonym = CONCAT('K-', LPAD(id, 4, '0')) WHERE synonym IS NULL",
  },
  {
    name: "synonyme backfill suppliers",
    check: (db) =>
      `SELECT COUNT(*) AS v FROM suppliers WHERE synonym IS NULL`,
    ddl: "UPDATE suppliers SET synonym = CONCAT('L-', LPAD(id, 4, '0')) WHERE synonym IS NULL",
  },
  {
    // v1.8 Schritt 3: Enum auf Endzustand (ohne 'finalisiert')
    name: "offers.status Enum final",
    check: (db) =>
      `SELECT COLUMN_TYPE AS v FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='${db}' AND TABLE_NAME='offers' AND COLUMN_NAME='status' AND COLUMN_TYPE NOT LIKE '%finalisiert%'`,
    ddl: "ALTER TABLE offers MODIFY status ENUM('entwurf','offen','bestaetigt','abgelehnt','umgewandelt','storniert') NOT NULL DEFAULT 'entwurf'",
  },
];

const NEUE_INDIZES: { tabelle: string; index: string; ddl: string }[] = [
  { tabelle: "users", index: "users_username_unique", ddl: "ALTER TABLE users ADD UNIQUE INDEX users_username_unique (username)" },
];

export async function migriereFehlendeSpalten(): Promise<void> {
  const db = getDb();
  const dbName = new URL(process.env.DATABASE_URL!).pathname.replace(/^\//, "").split("?")[0];
  const fehler: string[] = [];

  for (const s of NEUE_SPALTEN) {
    try {
      const [rows] = (await db.execute(
        sql.raw(
          `SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='${dbName}' AND TABLE_NAME='${s.tabelle}' AND COLUMN_NAME='${s.spalte}'`,
        ),
      )) as unknown as [{ n: number }[], unknown];
      if (Number(rows[0]?.n ?? 0) === 0) {
        console.log(`[migrate] + ${s.tabelle}.${s.spalte}`);
        await db.execute(sql.raw(s.ddl));
      }
    } catch (e) {
      const msg = `${s.tabelle}.${s.spalte}: ${e instanceof Error ? e.message : String(e)}`;
      fehler.push(msg);
      console.error(`[migrate] FEHLER bei ${msg}`);
    }
  }

  for (const t of NEUE_TABELLEN) {
    try {
      const [rows] = (await db.execute(
        sql.raw(
          `SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA='${dbName}' AND TABLE_NAME='${t.tabelle}'`,
        ),
      )) as unknown as [{ n: number }[], unknown];
      if (Number(rows[0]?.n ?? 0) === 0) {
        console.log(`[migrate] + Tabelle ${t.tabelle}`);
        await db.execute(sql.raw(t.ddl));
      }
    } catch (e) {
      const msg = `Tabelle ${t.tabelle}: ${e instanceof Error ? e.message : String(e)}`;
      fehler.push(msg);
      console.error(`[migrate] FEHLER bei ${msg}`);
    }
  }

  for (const u of SCHEMA_UPDATES) {
    try {
      const [rows] = (await db.execute(sql.raw(u.check(dbName)))) as unknown as [{ v: string }[], unknown];
      if (rows.length === 0) {
        console.log(`[migrate] ~ ${u.name}`);
        await db.execute(sql.raw(u.ddl));
      }
    } catch (e) {
      const msg = `Update ${u.name}: ${e instanceof Error ? e.message : String(e)}`;
      fehler.push(msg);
      console.error(`[migrate] FEHLER bei ${msg}`);
    }
  }

  for (const i of NEUE_INDIZES) {
    try {
      const [rows] = (await db.execute(
        sql.raw(
          `SELECT COUNT(*) AS n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA='${dbName}' AND TABLE_NAME='${i.tabelle}' AND INDEX_NAME='${i.index}'`,
        ),
      )) as unknown as [{ n: number }[], unknown];
      if (Number(rows[0]?.n ?? 0) === 0) {
        console.log(`[migrate] + Index ${i.index}`);
        await db.execute(sql.raw(i.ddl));
      }
    } catch (e) {
      const msg = `Index ${i.index}: ${e instanceof Error ? e.message : String(e)}`;
      fehler.push(msg);
      console.error(`[migrate] FEHLER bei ${msg}`);
    }
  }

  if (fehler.length > 0) {
    console.error(`[migrate] Abgeschlossen mit ${fehler.length} fehlgeschlagenen Schritt(en):`, fehler);
  } else {
    console.log("[migrate] Schema aktuell — nichts zu tun bzw. alles erfolgreich angelegt.");
  }
}
