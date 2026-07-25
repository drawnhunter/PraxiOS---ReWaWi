import {
  mysqlTable,
  mysqlEnum,
  serial,
  bigint,
  varchar,
  text,
  int,
  decimal,
  boolean,
  timestamp,
  date,
  index,
  unique,
  uniqueIndex,
} from "drizzle-orm/mysql-core";

// ── Firmen-Einstellungen (Singleton, id = 1) ────────────────────────────────
export const companySettings = mysqlTable("company_settings", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  strasse: varchar("strasse", { length: 255 }).notNull(),
  plz: varchar("plz", { length: 20 }).notNull(),
  ort: varchar("ort", { length: 100 }).notNull(),
  land: varchar("land", { length: 100 }).notNull().default("Deutschland"),
  handelsregister: varchar("handelsregister", { length: 100 }),
  steuernummer: varchar("steuernummer", { length: 50 }),
  ustIdNr: varchar("ust_id_nr", { length: 50 }),
  email: varchar("email", { length: 320 }),
  telefon: varchar("telefon", { length: 50 }),
  webseite: varchar("webseite", { length: 255 }),
  standardZahlungsziel: int("standard_zahlungsziel").notNull().default(14),
  fussText: text("fuss_text"),
  // DATEV-Export (Buchungsstapel)
  datevBeraternummer: varchar("datev_beraternummer", { length: 20 }),
  datevMandantennummer: varchar("datev_mandantennummer", { length: 20 }),
  datevKontenrahmen: varchar("datev_kontenrahmen", { length: 10 }).notNull().default("SKR03"),
  erloeskonto19: varchar("erloeskonto_19", { length: 10 }).notNull().default("8400"),
  erloeskonto7: varchar("erloeskonto_7", { length: 10 }).notNull().default("8300"),
  erloeskonto0: varchar("erloeskonto_0", { length: 10 }).notNull().default("8120"),
  debitorStartnummer: int("debitor_startnummer").notNull().default(10000),
  // Design
  akzentfarbe: varchar("akzentfarbe", { length: 30 }).notNull().default("neutral"),
  pdfLayout: varchar("pdf_layout", { length: 30 }).notNull().default("klassisch"),
  // E-Mail-Versand (SMTP); Passwort liegt verschluesselt vor
  smtpHost: varchar("smtp_host", { length: 255 }),
  smtpPort: int("smtp_port").notNull().default(587),
  smtpUser: varchar("smtp_user", { length: 255 }),
  smtpPasswortEnc: varchar("smtp_passwort_enc", { length: 500 }),
  smtpAbsender: varchar("smtp_absender", { length: 255 }),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});

// ── Bankkonten ──────────────────────────────────────────────────────────────
export const bankAccounts = mysqlTable("bank_accounts", {
  id: serial("id").primaryKey(),
  bezeichnung: varchar("bezeichnung", { length: 100 }).notNull(),
  bankName: varchar("bank_name", { length: 255 }).notNull(),
  kontoinhaber: varchar("kontoinhaber", { length: 255 }).notNull(),
  iban: varchar("iban", { length: 40 }).notNull(),
  bic: varchar("bic", { length: 15 }),
  istStandard: boolean("ist_standard").notNull().default(false),
  aktiv: boolean("aktiv").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ── Kunden ──────────────────────────────────────────────────────────────────
export const customers = mysqlTable(
  "customers",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    zusatz: varchar("zusatz", { length: 255 }),
    strasse: varchar("strasse", { length: 255 }).notNull(),
    plz: varchar("plz", { length: 20 }).notNull(),
    ort: varchar("ort", { length: 100 }).notNull(),
    land: varchar("land", { length: 100 }).notNull().default("Deutschland"),
    email: varchar("email", { length: 320 }),
    telefon: varchar("telefon", { length: 50 }),
    ustIdNr: varchar("ust_id_nr", { length: 50 }),
    zahlungszielTage: int("zahlungsziel_tage"),
    debitornummer: int("debitornummer"),
    notizen: text("notizen"),
    archiviert: boolean("archiviert").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    nameIdx: index("customers_name_idx").on(t.name),
  }),
);

// ── Produkte / Leistungen ───────────────────────────────────────────────────
export const products = mysqlTable("products", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  artikelnummer: varchar("artikelnummer", { length: 50 }),
  beschreibung: text("beschreibung"),
  einheit: varchar("einheit", { length: 30 }).notNull().default("Stück"),
  preisNetto: decimal("preis_netto", { precision: 12, scale: 2 }).notNull(),
  ekPreisNetto: decimal("ek_preis_netto", { precision: 12, scale: 2 }),
  kategorie: varchar("kategorie", { length: 60 }),
  barcode: varchar("barcode", { length: 60 }),
  mindestbestand: decimal("mindestbestand", { precision: 12, scale: 2 }),
  lagerAktiv: boolean("lager_aktiv").notNull().default(false),
  ustSatz: int("ust_satz").notNull().default(19),
  aktiv: boolean("aktiv").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Sonderpreise: abweichender VK (Kunde) bzw. EK (Lieferant) je Produkt
export const konditionen = mysqlTable(
  "konditionen",
  {
    id: serial("id").primaryKey(),
    typ: mysqlEnum("typ", ["kunde", "lieferant"]).notNull(),
    partnerId: bigint("partner_id", { mode: "number", unsigned: true }).notNull(),
    productId: bigint("product_id", { mode: "number", unsigned: true })
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    preisNetto: decimal("preis_netto", { precision: 12, scale: 2 }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("konditionen_eindeutig").on(t.typ, t.partnerId, t.productId)],
);

// ── Nummernkreise (GoBD: lückenlos, nur hochzählen) ────────────────────────
// typ: "invoice" | "credit_note" | "delivery_note" | "purchase_order"
export const numberSequences = mysqlTable(
  "number_sequences",
  {
    id: serial("id").primaryKey(),
    typ: varchar("typ", { length: 30 }).notNull(),
    jahr: int("jahr").notNull(),
    letzteNummer: int("letzte_nummer").notNull().default(0),
  },
  (t) => ({
    uniqTypJahr: unique("uniq_typ_jahr").on(t.typ, t.jahr),
  }),
);

// ── Rechnungen ──────────────────────────────────────────────────────────────
export const invoices = mysqlTable(
  "invoices",
  {
    id: serial("id").primaryKey(),
    // Nummer wird erst bei Finalisierung vergeben (Entwürfe haben keine)
    nummer: varchar("nummer", { length: 20 }).unique(),
    status: mysqlEnum("status", ["entwurf", "finalisiert", "storniert"])
      .notNull()
      .default("entwurf"),
    customerId: bigint("customer_id", { mode: "number", unsigned: true }).notNull(),
    rechnungsdatum: date("rechnungsdatum", { mode: "string" }).notNull(),
    faelligkeitsdatum: date("faelligkeitsdatum", { mode: "string" }).notNull(),
    leistungsdatum: varchar("leistungsdatum", { length: 120 }),
    bankAccountId: bigint("bank_account_id", { mode: "number", unsigned: true }),
    // Kunden-Snapshot (wird beim Anlegen aus dem Kunden kopiert, danach editierbar)
    kundeName: varchar("kunde_name", { length: 255 }).notNull(),
    kundeZusatz: varchar("kunde_zusatz", { length: 255 }),
    kundeStrasse: varchar("kunde_strasse", { length: 255 }).notNull(),
    kundePlz: varchar("kunde_plz", { length: 20 }).notNull(),
    kundeOrt: varchar("kunde_ort", { length: 100 }).notNull(),
    kundeLand: varchar("kunde_land", { length: 100 }).notNull().default("Deutschland"),
    // Firmen- und Bank-Snapshot bei Finalisierung (JSON)
    firmenSnapshot: text("firmen_snapshot"),
    bankSnapshot: text("bank_snapshot"),
    // Summen (serverseitig berechnet)
    netto: decimal("netto", { precision: 12, scale: 2 }).notNull().default("0"),
    ust: decimal("ust", { precision: 12, scale: 2 }).notNull().default("0"),
    brutto: decimal("brutto", { precision: 12, scale: 2 }).notNull().default("0"),
    bezahltBetrag: decimal("bezahlt_betrag", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    bezahltAm: date("bezahlt_am", { mode: "string" }),
    bereitsBezahlt: boolean("bereits_bezahlt").notNull().default(false),
    pdfNotiz: text("pdf_notiz"),
    bemerkung: text("bemerkung"),
    finalizedAt: timestamp("finalized_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (t) => ({
    statusIdx: index("invoices_status_idx").on(t.status),
    datumIdx: index("invoices_datum_idx").on(t.rechnungsdatum),
  }),
);

export const invoiceItems = mysqlTable(
  "invoice_items",
  {
    id: serial("id").primaryKey(),
    invoiceId: bigint("invoice_id", { mode: "number", unsigned: true }).notNull(),
    position: int("position").notNull(),
    bezeichnung: varchar("bezeichnung", { length: 500 }).notNull(),
    beschreibung: text("beschreibung"),
    menge: decimal("menge", { precision: 10, scale: 3 }).notNull().default("1"),
    einheit: varchar("einheit", { length: 30 }).notNull().default("Stück"),
    einzelpreis: decimal("einzelpreis", { precision: 12, scale: 2 }).notNull(),
    ustSatz: int("ust_satz").notNull().default(19),
  },
  (t) => ({
    invoiceIdx: index("invoice_items_invoice_idx").on(t.invoiceId),
  }),
);

// ── Gutschriften (Storno) ───────────────────────────────────────────────────
export const creditNotes = mysqlTable(
  "credit_notes",
  {
    id: serial("id").primaryKey(),
    nummer: varchar("nummer", { length: 20 }).unique(),
    status: mysqlEnum("status", ["entwurf", "finalisiert"])
      .notNull()
      .default("entwurf"),
    invoiceId: bigint("invoice_id", { mode: "number", unsigned: true }).notNull(),
    datum: date("datum", { mode: "string" }).notNull(),
    grund: text("grund"),
    bankAccountId: bigint("bank_account_id", { mode: "number", unsigned: true }),
    // Kunden-Snapshot
    kundeName: varchar("kunde_name", { length: 255 }).notNull(),
    kundeZusatz: varchar("kunde_zusatz", { length: 255 }),
    kundeStrasse: varchar("kunde_strasse", { length: 255 }).notNull(),
    kundePlz: varchar("kunde_plz", { length: 20 }).notNull(),
    kundeOrt: varchar("kunde_ort", { length: 100 }).notNull(),
    kundeLand: varchar("kunde_land", { length: 100 }).notNull().default("Deutschland"),
    firmenSnapshot: text("firmen_snapshot"),
    netto: decimal("netto", { precision: 12, scale: 2 }).notNull().default("0"),
    ust: decimal("ust", { precision: 12, scale: 2 }).notNull().default("0"),
    brutto: decimal("brutto", { precision: 12, scale: 2 }).notNull().default("0"),
    finalizedAt: timestamp("finalized_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (t) => ({
    invoiceIdx: index("credit_notes_invoice_idx").on(t.invoiceId),
  }),
);

export const creditNoteItems = mysqlTable(
  "credit_note_items",
  {
    id: serial("id").primaryKey(),
    creditNoteId: bigint("credit_note_id", { mode: "number", unsigned: true }).notNull(),
    position: int("position").notNull(),
    bezeichnung: varchar("bezeichnung", { length: 500 }).notNull(),
    beschreibung: text("beschreibung"),
    menge: decimal("menge", { precision: 10, scale: 3 }).notNull().default("1"),
    einheit: varchar("einheit", { length: 30 }).notNull().default("Stück"),
    einzelpreis: decimal("einzelpreis", { precision: 12, scale: 2 }).notNull(),
    ustSatz: int("ust_satz").notNull().default(19),
  },
  (t) => ({
    creditIdx: index("credit_note_items_credit_idx").on(t.creditNoteId),
  }),
);

// ── Types ───────────────────────────────────────────────────────────────────
export type CompanySettings = typeof companySettings.$inferSelect;
export type BankAccount = typeof bankAccounts.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type InvoiceItem = typeof invoiceItems.$inferSelect;
export type CreditNote = typeof creditNotes.$inferSelect;
export type CreditNoteItem = typeof creditNoteItems.$inferSelect;

// ── Lieferanten ─────────────────────────────────────────────────────────────
export const suppliers = mysqlTable(
  "suppliers",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    zusatz: varchar("zusatz", { length: 255 }),
    strasse: varchar("strasse", { length: 255 }).notNull(),
    plz: varchar("plz", { length: 20 }).notNull(),
    ort: varchar("ort", { length: 100 }).notNull(),
    land: varchar("land", { length: 100 }).notNull().default("Deutschland"),
    email: varchar("email", { length: 320 }),
    telefon: varchar("telefon", { length: 50 }),
    ustIdNr: varchar("ust_id_nr", { length: 50 }),
    notizen: text("notizen"),
    archiviert: boolean("archiviert").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    nameIdx: index("suppliers_name_idx").on(t.name),
  }),
);

// ── Bestellungen (Einkauf) ──────────────────────────────────────────────────
export const purchaseOrders = mysqlTable(
  "purchase_orders",
  {
    id: serial("id").primaryKey(),
    nummer: varchar("nummer", { length: 20 }).unique(),
    status: mysqlEnum("status", [
      "entwurf",
      "bestellt",
      "teilgeliefert",
      "geliefert",
      "storniert",
    ])
      .notNull()
      .default("entwurf"),
    supplierId: bigint("supplier_id", { mode: "number", unsigned: true }).notNull(),
    bestelldatum: date("bestelldatum", { mode: "string" }).notNull(),
    lieferdatum: date("lieferdatum", { mode: "string" }),
    // Lieferanten-Snapshot
    lieferantName: varchar("lieferant_name", { length: 255 }).notNull(),
    lieferantZusatz: varchar("lieferant_zusatz", { length: 255 }),
    lieferantStrasse: varchar("lieferant_strasse", { length: 255 }).notNull(),
    lieferantPlz: varchar("lieferant_plz", { length: 20 }).notNull(),
    lieferantOrt: varchar("lieferant_ort", { length: 100 }).notNull(),
    lieferantLand: varchar("lieferant_land", { length: 100 })
      .notNull()
      .default("Deutschland"),
    firmenSnapshot: text("firmen_snapshot"),
    pdfNotiz: text("pdf_notiz"),
    bemerkung: text("bemerkung"),
    netto: decimal("netto", { precision: 12, scale: 2 }).notNull().default("0"),
    ust: decimal("ust", { precision: 12, scale: 2 }).notNull().default("0"),
    brutto: decimal("brutto", { precision: 12, scale: 2 }).notNull().default("0"),
    bestelltAt: timestamp("bestellt_at"),
    geliefertAm: date("geliefert_am", { mode: "string" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (t) => ({
    statusIdx: index("po_status_idx").on(t.status),
    supplierIdx: index("po_supplier_idx").on(t.supplierId),
  }),
);

export const purchaseOrderItems = mysqlTable(
  "purchase_order_items",
  {
    id: serial("id").primaryKey(),
    purchaseOrderId: bigint("purchase_order_id", {
      mode: "number",
      unsigned: true,
    }).notNull(),
    position: int("position").notNull(),
    bezeichnung: varchar("bezeichnung", { length: 500 }).notNull(),
    beschreibung: text("beschreibung"),
    menge: decimal("menge", { precision: 10, scale: 3 }).notNull().default("1"),
    einheit: varchar("einheit", { length: 30 }).notNull().default("Stück"),
    einzelpreis: decimal("einzelpreis", { precision: 12, scale: 2 }).notNull(),
    ustSatz: int("ust_satz").notNull().default(19),
  },
  (t) => ({
    poIdx: index("po_items_po_idx").on(t.purchaseOrderId),
  }),
);

// ── Lieferscheine (Verkauf, ohne Preise) ────────────────────────────────────
export const deliveryNotes = mysqlTable(
  "delivery_notes",
  {
    id: serial("id").primaryKey(),
    nummer: varchar("nummer", { length: 20 }).unique(),
    status: mysqlEnum("status", ["entwurf", "finalisiert", "storniert"])
      .notNull()
      .default("entwurf"),
    customerId: bigint("customer_id", { mode: "number", unsigned: true }).notNull(),
    invoiceId: bigint("invoice_id", { mode: "number", unsigned: true }),
    datum: date("datum", { mode: "string" }).notNull(),
    // Kunden-Snapshot
    kundeName: varchar("kunde_name", { length: 255 }).notNull(),
    kundeZusatz: varchar("kunde_zusatz", { length: 255 }),
    kundeStrasse: varchar("kunde_strasse", { length: 255 }).notNull(),
    kundePlz: varchar("kunde_plz", { length: 20 }).notNull(),
    kundeOrt: varchar("kunde_ort", { length: 100 }).notNull(),
    kundeLand: varchar("kunde_land", { length: 100 }).notNull().default("Deutschland"),
    firmenSnapshot: text("firmen_snapshot"),
    pdfNotiz: text("pdf_notiz"),
    bemerkung: text("bemerkung"),
    finalizedAt: timestamp("finalized_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (t) => ({
    customerIdx: index("dn_customer_idx").on(t.customerId),
    invoiceIdx: index("dn_invoice_idx").on(t.invoiceId),
  }),
);

export const deliveryNoteItems = mysqlTable(
  "delivery_note_items",
  {
    id: serial("id").primaryKey(),
    deliveryNoteId: bigint("delivery_note_id", {
      mode: "number",
      unsigned: true,
    }).notNull(),
    position: int("position").notNull(),
    bezeichnung: varchar("bezeichnung", { length: 500 }).notNull(),
    beschreibung: text("beschreibung"),
    menge: decimal("menge", { precision: 10, scale: 3 }).notNull().default("1"),
    einheit: varchar("einheit", { length: 30 }).notNull().default("Stück"),
  },
  (t) => ({
    dnIdx: index("dn_items_dn_idx").on(t.deliveryNoteId),
  }),
);

export type Supplier = typeof suppliers.$inferSelect;
export type PurchaseOrder = typeof purchaseOrders.$inferSelect;
export type PurchaseOrderItem = typeof purchaseOrderItems.$inferSelect;
export type DeliveryNote = typeof deliveryNotes.$inferSelect;
export type DeliveryNoteItem = typeof deliveryNoteItems.$inferSelect;

export const users = mysqlTable("users", {
  id: serial("id").primaryKey(),
  unionId: varchar("unionId", { length: 255 }).notNull().unique(),
  username: varchar("username", { length: 100 }).unique(),
  passwordHash: varchar("passwordHash", { length: 255 }),
  name: varchar("name", { length: 255 }),
  email: varchar("email", { length: 320 }),
  avatar: text("avatar"),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
  lastSignInAt: timestamp("lastSignInAt").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ── Mahnwesen (Zahlungserinnerungen/Mahnungen zu Rechnungen) ────────────────
export const reminders = mysqlTable(
  "reminders",
  {
    id: serial("id").primaryKey(),
    invoiceId: bigint("invoice_id", { mode: "number", unsigned: true }).notNull(),
    stufe: int("stufe").notNull(), // 1 = Zahlungserinnerung, 2 = 1. Mahnung, 3 = 2. Mahnung
    datum: date("datum", { mode: "string" }).notNull(),
    zahlungsfrist: date("zahlungsfrist", { mode: "string" }).notNull(),
    offenBetrag: decimal("offen_betrag", { precision: 12, scale: 2 }).notNull(),
    bemerkung: text("bemerkung"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    reIdx: index("reminders_invoice_idx").on(t.invoiceId),
  }),
);

// ── Angebote ────────────────────────────────────────────────────────────────
export const offers = mysqlTable(
  "offers",
  {
    id: serial("id").primaryKey(),
    nummer: varchar("nummer", { length: 20 }).unique(),
    status: mysqlEnum("status", ["entwurf", "finalisiert", "umgewandelt", "storniert"])
      .notNull()
      .default("entwurf"),
    customerId: bigint("customer_id", { mode: "number", unsigned: true }).notNull(),
    datum: date("datum", { mode: "string" }).notNull(),
    gueltigBis: date("gueltig_bis", { mode: "string" }),
    kundeName: varchar("kunde_name", { length: 255 }).notNull(),
    kundeZusatz: varchar("kunde_zusatz", { length: 255 }),
    kundeStrasse: varchar("kunde_strasse", { length: 255 }).notNull(),
    kundePlz: varchar("kunde_plz", { length: 20 }).notNull(),
    kundeOrt: varchar("kunde_ort", { length: 100 }).notNull(),
    kundeLand: varchar("kunde_land", { length: 100 }).notNull().default("Deutschland"),
    firmenSnapshot: text("firmen_snapshot"),
    netto: decimal("netto", { precision: 12, scale: 2 }).notNull().default("0"),
    ust: decimal("ust", { precision: 12, scale: 2 }).notNull().default("0"),
    brutto: decimal("brutto", { precision: 12, scale: 2 }).notNull().default("0"),
    pdfNotiz: text("pdf_notiz"),
    bemerkung: text("bemerkung"),
    convertedInvoiceId: bigint("converted_invoice_id", { mode: "number", unsigned: true }),
    finalizedAt: timestamp("finalized_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (t) => ({
    statusIdx: index("offers_status_idx").on(t.status),
  }),
);

export const offerItems = mysqlTable(
  "offer_items",
  {
    id: serial("id").primaryKey(),
    offerId: bigint("offer_id", { mode: "number", unsigned: true }).notNull(),
    position: int("position").notNull(),
    bezeichnung: varchar("bezeichnung", { length: 255 }).notNull(),
    beschreibung: text("beschreibung"),
    menge: decimal("menge", { precision: 12, scale: 3 }).notNull(),
    einheit: varchar("einheit", { length: 30 }).notNull().default("Stück"),
    einzelpreis: decimal("einzelpreis", { precision: 12, scale: 2 }).notNull(),
    ustSatz: int("ust_satz").notNull().default(19),
  },
  (t) => ({
    angebotIdx: index("offer_items_offer_idx").on(t.offerId),
  }),
);

export type Reminder = typeof reminders.$inferSelect;
export type Offer = typeof offers.$inferSelect;
export type OfferItem = typeof offerItems.$inferSelect;

// Versandprotokoll fuer E-Mails (Nachvollziehbarkeit)
export const mailLog = mysqlTable("mail_log", {
  id: serial("id").primaryKey(),
  belegArt: varchar("beleg_art", { length: 30 }).notNull(),
  belegId: bigint("beleg_id", { mode: "number", unsigned: true }).notNull(),
  empfaenger: varchar("empfaenger", { length: 320 }).notNull(),
  betreff: varchar("betreff", { length: 500 }).notNull(),
  erfolg: boolean("erfolg").notNull(),
  fehler: text("fehler"),
  gesendetAm: timestamp("gesendet_am").notNull().defaultNow(),
});

// Eingangsrechnungen (empfangene E-Rechnungen)
export const incomingInvoices = mysqlTable(
  "incoming_invoices",
  {
    id: serial("id").primaryKey(),
    lieferantName: varchar("lieferant_name", { length: 255 }).notNull(),
    lieferantKennung: varchar("lieferant_kennung", { length: 255 }),
    nummer: varchar("nummer", { length: 100 }).notNull(),
    rechnungsdatum: date("rechnungsdatum", { mode: "string" }).notNull(),
    faelligkeitsdatum: date("faelligkeitsdatum", { mode: "string" }),
    netto: decimal("netto", { precision: 12, scale: 2 }).notNull(),
    ust: decimal("ust", { precision: 12, scale: 2 }).notNull(),
    brutto: decimal("brutto", { precision: 12, scale: 2 }).notNull(),
    waehrung: varchar("waehrung", { length: 10 }).notNull().default("EUR"),
    bezahltAm: date("bezahlt_am", { mode: "string" }),
    positionenJson: text("positionen_json"),
    originalXml: text("original_xml"),
    bemerkung: text("bemerkung"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("incoming_eindeutig").on(t.lieferantName, t.nummer)],
);

// Lagerbewegungen: Bestand = Summe aller Bewegungen je Produkt (auditfest)
export const lagerBewegungen = mysqlTable("lager_bewegungen", {
  id: serial("id").primaryKey(),
  productId: bigint("product_id", { mode: "number", unsigned: true })
    .notNull()
    .references(() => products.id, { onDelete: "cascade" }),
  typ: mysqlEnum("typ", ["zugang", "abgang", "korrektur", "inventur"]).notNull(),
  menge: decimal("menge", { precision: 12, scale: 2 }).notNull(), // vorzeichenbehaftet
  datum: date("datum", { mode: "string" }).notNull(),
  bemerkung: varchar("bemerkung", { length: 500 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Serien-Rechnungen: wiederkehrende Belege (Vorlage, kein GoBD-Beleg)
export const invoiceSeries = mysqlTable("invoice_series", {
  id: serial("id").primaryKey(),
  customerId: bigint("customer_id", { mode: "number", unsigned: true })
    .notNull()
    .references(() => customers.id, { onDelete: "cascade" }),
  titel: varchar("titel", { length: 255 }).notNull(),
  intervallTage: int("intervall_tage").notNull().default(30),
  naechsteFaellig: date("naechste_faellig", { mode: "string" }).notNull(),
  itemsJson: text("items_json").notNull(),
  bemerkung: text("bemerkung"),
  aktiv: boolean("aktiv").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
