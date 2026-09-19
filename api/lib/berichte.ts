// ── Berichts-Kern: baut alle Berichte aus einer generischen Form ──────────
// Wird von berichteRouter (tRPC), berichtPdf und der Agent-API geteilt.
import { getDb } from "../queries/connection";
import {
  invoices, incomingInvoices, bankTransaktionen, bankAccounts,
  customers, kategorien,
} from "@db/schema";
import { and, asc, desc, eq, gte, isNotNull, isNull, lte, sql } from "drizzle-orm";

export interface BerichtSpalte { titel: string; rechts?: boolean }
export interface BerichtZeile { zellen: (string | number | null)[]; stark?: boolean; ebene?: number }
export interface Bericht {
  id: string;
  titel: string;
  beschreibung?: string;
  zeitraum: { von: string; bis: string };
  spalten: BerichtSpalte[];
  zeilen: BerichtZeile[];
  summenZeile?: (string | number | null)[];
  hinweise?: string[];
}

export interface BerichtParams { von: string; bis: string; kontoId?: number; satz?: number }

export const BERICHT_KATALOG: { id: string; titel: string; beschreibung: string; gruppe: string }[] = [
  { id: "euer", titel: "Einnahmen-Überschuss-Rechnung (EÜR)", beschreibung: "Gewinnermittlung nach Zuflussprinzip, gruppiert nach Kategorien", gruppe: "Steuern & Abschluss" },
  { id: "steuer-ruecklage", titel: "Steuer-Rücklage & USt-Prognose", beschreibung: "USt-Zahllast des Zeitraums + Ertragsteuer-Rücklage vs. Kontostand", gruppe: "Steuern & Abschluss" },
  { id: "zm", titel: "ZM-Arbeitsliste (EU-Umsätze)", beschreibung: "Umsätze an EU-Ausland als Arbeitsliste für die Zusammenfassende Meldung", gruppe: "Steuern & Abschluss" },
  { id: "debitoren", titel: "Offene Posten — Debitoren", beschreibung: "Außenstände mit Fälligkeitsstaffeln (Aging)", gruppe: "Forderungen & Lieferanten" },
  { id: "kreditoren", titel: "Offene Posten — Kreditoren", beschreibung: "Offene Lieferantenrechnungen mit Fälligkeit", gruppe: "Forderungen & Lieferanten" },
  { id: "zahlungsverhalten", titel: "Zahlungsverhalten der Kunden", beschreibung: "Ø Zahlungsdauer, Verspätungen und offene Beträge je Kunde", gruppe: "Forderungen & Lieferanten" },
  { id: "kontenblatt", titel: "Kontenblatt", beschreibung: "Alle Buchungen eines Kontos mit laufendem Saldo", gruppe: "Bank & Liquidität" },
  { id: "liquiditaets-vorschau", titel: "Liquiditäts-Vorschau (90 Tage)", beschreibung: "Saldo + geplante Ein-/Ausgänge aus offenen Posten", gruppe: "Bank & Liquidität" },
  { id: "sumup-gebuehren", titel: "SumUp-Gebühren", beschreibung: "Brutto, Gebühren, Auszahlungen und effektiver Gebührensatz je Monat", gruppe: "Bank & Liquidität" },
  { id: "fehlende-belege", titel: "Fehlende Belege", beschreibung: "Kategorisierte Bankausgaben ohne Beleg + Belege ohne Zahlung", gruppe: "Bank & Liquidität" },
  { id: "ausgaben-kategorien", titel: "Ausgaben nach Kategorie", beschreibung: "Ausgaben gruppiert nach Kategorie (mit SKR-Konto) und Anteilen", gruppe: "Analysen" },
  { id: "umsatz-kunden", titel: "Umsatz nach Kunde", beschreibung: "Rechnungssummen je Kunde im Zeitraum, inkl. offener Anteile", gruppe: "Analysen" },
];

const heute = () => new Date().toISOString().slice(0, 10);
const euro = (n: number) => Math.round(n * 100) / 100;
const TAGE_MS = 86400000;

function pruefeZeitraum(von: string, bis: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(von) || !/^\d{4}-\d{2}-\d{2}$/.test(bis)) {
    throw new Error("von/bis im Format JJJJ-MM-TT nötig.");
  }
}

/** Gemeinsame Datenbasis: Einnahmen/Ausgaben nach Zuflussprinzip (bezahltAm im Zeitraum). */
async function ladeFluesse(von: string, bis: string) {
  const db = getDb();
  // Beleg-Einnahmen: finalisierte Rechnungen mit Zahlungsdatum im Zeitraum
  const reEin = await db.select().from(invoices).where(
    and(eq(invoices.status, "finalisiert"), isNotNull(invoices.bezahltAm), gte(invoices.bezahltAm, von), lte(invoices.bezahltAm, bis)),
  );
  // Beleg-Ausgaben: Eingangsrechnungen mit Zahlungsdatum im Zeitraum
  const reAus = await db.select().from(incomingInvoices).where(
    and(isNotNull(incomingInvoices.bezahltAm), gte(incomingInvoices.bezahltAm, von), lte(incomingInvoices.bezahltAm, bis)),
  );
  // Bank-Flüsse ohne Belegbezug (kategorisiert, sonst landen sie in „Sonstiges")
  const bankFluesse = await db.select().from(bankTransaktionen).where(
    and(gte(bankTransaktionen.datum, von), lte(bankTransaktionen.datum, bis), isNull(bankTransaktionen.invoiceId), isNull(bankTransaktionen.incomingInvoiceId)),
  );
  return { reEin, reAus, bankFluesse };
}

function kategorieName(id: number | null, karte: Map<number, string>, fallback: string): string {
  return id !== null ? (karte.get(id) ?? fallback) : fallback;
}

async function kategorienKarte(): Promise<Map<number, { name: string; konto: string | null; typ: string }>> {
  const rows = await getDb().select().from(kategorien);
  return new Map(rows.map((k) => [k.id, { name: k.name, konto: k.konto, typ: k.typ }]));
}

// ── 1. EÜR ──────────────────────────────────────────────────────────────────
async function berichtEuer(p: BerichtParams): Promise<Bericht> {
  const { reEin, reAus, bankFluesse } = await ladeFluesse(p.von, p.bis);
  const kat = await kategorienKarte();
  const ein: Record<string, number> = {};
  const aus: Record<string, number> = {};

  for (const r of reEin) {
    const k = "Einnahmen aus Rechnungen";
    ein[k] = (ein[k] ?? 0) + Number(r.netto);
  }
  for (const r of reAus) {
    const k = kategorieName(r.kategorieId, new Map([...kat].map(([id, v]) => [id, v.name])), "Betriebsausgaben (Belege)");
    aus[k] = (aus[k] ?? 0) + Number(r.netto);
  }
  let bankEin = 0, bankAus = 0;
  const bankAusNachKat: Record<string, number> = {};
  for (const t of bankFluesse) {
    const betrag = Number(t.betrag);
    if (betrag >= 0) bankEin += betrag;
    else {
      const k = kategorieName(t.kategorieId, new Map([...kat].map(([id, v]) => [id, v.name])), "Sonstige Ausgaben (Bank, ohne Kategorie)");
      bankAusNachKat[k] = (bankAusNachKat[k] ?? 0) + Math.abs(betrag);
      bankAus += Math.abs(betrag);
    }
  }

  const zeilen: BerichtZeile[] = [];
  const summe = (r: Record<string, number>) => Object.values(r).reduce((s, n) => s + n, 0);
  zeilen.push({ zellen: ["EINNAHMEN (netto)", null], stark: true });
  for (const [k, v] of Object.entries(ein).sort((a, b) => b[1] - a[1])) zeilen.push({ zellen: [k, euro(v)], ebene: 1 });
  if (bankEin > 0) zeilen.push({ zellen: ["Sonstige Einnahmen (Bank, brutto)", euro(bankEin)], ebene: 1 });
  const summeEin = summe(ein) + bankEin;
  zeilen.push({ zellen: ["Summe Einnahmen", euro(summeEin)], stark: true });
  zeilen.push({ zellen: ["", null] });
  zeilen.push({ zellen: ["AUSGABEN (netto)", null], stark: true });
  const ausGesamt = { ...aus };
  for (const [k, v] of Object.entries(bankAusNachKat)) ausGesamt[k] = (ausGesamt[k] ?? 0) + v;
  for (const [k, v] of Object.entries(ausGesamt).sort((a, b) => b[1] - a[1])) zeilen.push({ zellen: [k, euro(v)], ebene: 1 });
  const summeAus = summe(aus) + bankAus;
  zeilen.push({ zellen: ["Summe Ausgaben", euro(summeAus)], stark: true });

  return {
    id: "euer", titel: "Einnahmen-Überschuss-Rechnung", zeitraum: { von: p.von, bis: p.bis },
    spalten: [{ titel: "Position" }, { titel: "Betrag (€)", rechts: true }],
    zeilen,
    summenZeile: ["Überschuss / Gewinn", euro(summeEin - summeAus)],
    hinweise: [
      "Zuflussprinzip (Ist-Versteuerung): gezählt wird, was im Zeitraum zugeflossen ist (Zahlungsdatum).",
      "Belegwerte sind Netto; Bankbuchungen ohne Belegbezug sind Bruttowerte (USt-Aufschlüsselung dort nicht möglich).",
      "Arbeitsgrundlage für die Anlage EÜR — die formelle Erklärung erfolgt über den Steuerberater/ELSTER.",
    ],
  };
}

// ── 2. Steuer-Rücklage & USt-Prognose ───────────────────────────────────────
async function berichtSteuerRuecklage(p: BerichtParams): Promise<Bericht> {
  const satz = p.satz && p.satz > 0 && p.satz < 60 ? p.satz : 30;
  const { reEin, reAus } = await ladeFluesse(p.von, p.bis);
  const ustEinnahmen = reEin.reduce((s, r) => s + Number(r.ust), 0);
  const ustAusgaben = reAus.reduce((s, r) => s + Number(r.ust), 0);
  const zahllast = ustEinnahmen - ustAusgaben;
  const euer = await berichtEuer(p);
  const gewinn = Number(euer.summenZeile?.[1] ?? 0);
  const ertragRuecklage = Math.max(0, (gewinn * satz) / 100);
  const konten = await getDb().select().from(bankAccounts);
  let saldoGesamt = 0;
  const db = getDb();
  for (const k of konten) {
    const [letzte] = await db
      .select({ saldo: bankTransaktionen.saldoNach })
      .from(bankTransaktionen)
      .where(and(eq(bankTransaktionen.bankAccountId, k.id), isNotNull(bankTransaktionen.saldoNach)))
      .orderBy(desc(bankTransaktionen.datum), desc(bankTransaktionen.id))
      .limit(1);
    const [agg] = await db
      .select({ summe: sql<string>`COALESCE(SUM(${bankTransaktionen.betrag}), 0)` })
      .from(bankTransaktionen)
      .where(eq(bankTransaktionen.bankAccountId, k.id));
    saldoGesamt += letzte?.saldo != null ? Number(letzte.saldo) : Number(agg?.summe ?? 0);
  }
  const ruecklageGesamt = Math.max(0, zahllast) + ertragRuecklage;
  return {
    id: "steuer-ruecklage", titel: "Steuer-Rücklage & USt-Prognose", zeitraum: { von: p.von, bis: p.bis },
    spalten: [{ titel: "Position" }, { titel: "Betrag (€)", rechts: true }],
    zeilen: [
      { zellen: ["USt aus erhaltenen Zahlungen", euro(ustEinnahmen)] },
      { zellen: ["Vorsteuer aus bezahlten Eingangsrechnungen", euro(ustAusgaben)] },
      { zellen: ["USt-Zahllast des Zeitraums (Rücklage 1)", euro(zahllast)], stark: true },
      { zellen: ["", null] },
      { zellen: [`Ertragsteuer-Rücklage (${satz} % vom Überschuss ${euro(gewinn)} €)`, euro(ertragRuecklage)], stark: true },
      { zellen: ["Empfohlene Rücklage gesamt", euro(ruecklageGesamt)], stark: true },
      { zellen: ["", null] },
      { zellen: ["Aktueller Kontostand (alle Konten)", euro(saldoGesamt)] },
      { zellen: ["Frei verfügbar nach Rücklage", euro(saldoGesamt - ruecklageGesamt)], stark: true },
    ],
    hinweise: [
      "USt-Zahllast nach Zuflussprinzip des gewählten Zeitraums (nicht zwingend identisch mit dem UStVA-Meldezeitraum).",
      `Der Ertragsteuer-Satz (${satz} %) ist eine Planungsgröße — Parameter satz im Aufruf anpassbar.`,
      "Inspiriert von Kontists Echtzeit-Steuerschätzung — lokal gerechnet, ohne Unterkonto-Zwang.",
    ],
  };
}

// ── 3. ZM-Arbeitsliste ──────────────────────────────────────────────────────
async function berichtZm(p: BerichtParams): Promise<Bericht> {
  const db = getDb();
  const rows = await db
    .select({ r: invoices, kunde: customers })
    .from(invoices)
    .leftJoin(customers, eq(invoices.customerId, customers.id))
    .where(and(eq(invoices.status, "finalisiert"), gte(invoices.rechnungsdatum, p.von), lte(invoices.rechnungsdatum, p.bis)));
  const eu = rows.filter((x) => x.kunde && x.kunde.land && x.kunde.land !== "Deutschland");
  const zeilen: BerichtZeile[] = eu
    .sort((a, b) => (a.kunde!.land ?? "").localeCompare(b.kunde!.land ?? ""))
    .map((x) => ({
      zellen: [
        x.kunde!.land ?? "?", x.kunde!.name, x.kunde!.ustIdNr ?? "⚠ fehlt",
        x.r.nummer ?? `#${x.r.id}`, x.r.rechnungsdatum, euro(Number(x.r.netto)),
      ],
    }));
  const summe = eu.reduce((s, x) => s + Number(x.r.netto), 0);
  return {
    id: "zm", titel: "ZM-Arbeitsliste (EU-Umsätze)", zeitraum: { von: p.von, bis: p.bis },
    spalten: [{ titel: "Land" }, { titel: "Kunde" }, { titel: "USt-IdNr." }, { titel: "Rechnung" }, { titel: "Datum" }, { titel: "Netto (€)", rechts: true }],
    zeilen,
    summenZeile: ["Summe EU-Umsätze", null, null, null, null, euro(summe)],
    hinweise: [
      "Arbeitsliste für die Zusammenfassende Meldung (§ 18a UStG) — Abgabe erfolgt durch Steuerberater/ELSTER.",
      "Zeilen mit der Markierung ⚠ haben keine USt-IdNr. hinterlegt — ohne sie ist die ZM unvollständig.",
    ],
  };
}

// ── 4. Debitoren (Aging) ────────────────────────────────────────────────────
function agingStaffel(tageUeberfaellig: number): string {
  if (tageUeberfaellig <= 0) return "Noch nicht fällig";
  if (tageUeberfaellig <= 15) return "1–15 Tage überfällig";
  if (tageUeberfaellig <= 30) return "16–30 Tage überfällig";
  if (tageUeberfaellig <= 60) return "31–60 Tage überfällig";
  return "Über 60 Tage überfällig";
}

async function berichtDebitoren(_p: BerichtParams): Promise<Bericht> {
  const db = getDb();
  const rows = await db.select().from(invoices).where(eq(invoices.status, "finalisiert")).orderBy(asc(invoices.faelligkeitsdatum));
  const heuteS = heute();
  const offene = rows
    .map((r) => ({ r, offen: Number(r.brutto) - Number(r.bezahltBetrag) }))
    .filter((x) => x.offen > 0.004);
  const gruppen = new Map<string, BerichtZeile[]>();
  let gesamt = 0;
  for (const { r, offen } of offene) {
    const tage = Math.floor((new Date(heuteS).getTime() - new Date(r.faelligkeitsdatum).getTime()) / TAGE_MS);
    const g = agingStaffel(tage);
    if (!gruppen.has(g)) gruppen.set(g, []);
    gruppen.get(g)!.push({
      zellen: [r.nummer ?? `#${r.id}`, r.kundeName, r.rechnungsdatum, r.faelligkeitsdatum, Math.max(0, tage), euro(offen)],
    });
    gesamt += offen;
  }
  const reihenfolge = ["Über 60 Tage überfällig", "31–60 Tage überfällig", "16–30 Tage überfällig", "1–15 Tage überfällig", "Noch nicht fällig"];
  const zeilen: BerichtZeile[] = [];
  for (const g of reihenfolge) {
    const z = gruppen.get(g);
    if (!z?.length) continue;
    zeilen.push({ zellen: [`${g} (${z.length})`, null, null, null, null, euro(z.reduce((s, x) => s + Number(x.zellen[5]), 0))], stark: true });
    zeilen.push(...z.map((x) => ({ ...x, ebene: 1 })));
  }
  return {
    id: "debitoren", titel: "Offene Posten — Debitoren", zeitraum: { von: "—", bis: heuteS },
    spalten: [{ titel: "Rechnung" }, { titel: "Kunde" }, { titel: "Datum" }, { titel: "Fällig" }, { titel: "Tage überfällig", rechts: true }, { titel: "Offen (€)", rechts: true }],
    zeilen,
    summenZeile: ["Außenstände gesamt", null, null, null, null, euro(gesamt)],
    hinweise: ["Stichtag heute. Teilzahlungen sind berücksichtigt (offener Restbetrag)."],
  };
}

// ── 5. Kreditoren ───────────────────────────────────────────────────────────
async function berichtKreditoren(_p: BerichtParams): Promise<Bericht> {
  const db = getDb();
  const rows = await db.select().from(incomingInvoices).where(isNull(incomingInvoices.bezahltAm)).orderBy(asc(incomingInvoices.faelligkeitsdatum));
  const heuteS = heute();
  const istGutschrift = (r: (typeof rows)[number]) => r.typ === "gutschrift" || Number(r.brutto) < 0;
  const rechnungen = rows.filter((r) => !istGutschrift(r));
  const gutschriften = rows.filter(istGutschrift);
  const zeile = (r: (typeof rows)[number], faktor: 1 | -1 = 1): BerichtZeile => {
    const tage = r.faelligkeitsdatum ? Math.floor((new Date(heuteS).getTime() - new Date(r.faelligkeitsdatum).getTime()) / TAGE_MS) : 0;
    return {
      zellen: [r.lieferantName, r.nummer, r.rechnungsdatum, r.faelligkeitsdatum ?? "—", Math.max(0, tage), euro(faktor * Number(r.brutto))],
      stark: tage > 0,
    };
  };
  const zeilen: BerichtZeile[] = rechnungen.map((r) => zeile(r));
  if (gutschriften.length > 0) {
    zeilen.push({ zellen: ["", null, null, null, null, null] });
    zeilen.push({ zellen: [`GUTSCHRIFTEN / VERRECHNUNGEN (${gutschriften.length})`, null, null, null, null, euro(-gutschriften.reduce((s, r) => s + Math.abs(Number(r.brutto)), 0))], stark: true });
    for (const r of gutschriften) zeilen.push({ ...zeile(r, -1), ebene: 1 });
  }
  const gesamt = rechnungen.reduce((s, r) => s + Number(r.brutto), 0) - gutschriften.reduce((s, r) => s + Math.abs(Number(r.brutto)), 0);
  return {
    id: "kreditoren", titel: "Offene Posten — Kreditoren", zeitraum: { von: "—", bis: heuteS },
    spalten: [{ titel: "Lieferant" }, { titel: "Nummer" }, { titel: "Datum" }, { titel: "Fällig" }, { titel: "Tage überfällig", rechts: true }, { titel: "Offen (€)", rechts: true }],
    zeilen,
    summenZeile: ["Verbindlichkeiten gesamt (nach Verrechnung)", null, null, null, null, euro(gesamt)],
    hinweise: ["Fett = bereits fällig/überfällig. Gutschriften werden negativ verrechnet (eigene Sektion)."],
  };
}

// ── 6. Zahlungsverhalten ────────────────────────────────────────────────────
async function berichtZahlungsverhalten(p: BerichtParams): Promise<Bericht> {
  const db = getDb();
  const rows = await db.select().from(invoices).where(
    and(eq(invoices.status, "finalisiert"), gte(invoices.rechnungsdatum, p.von), lte(invoices.rechnungsdatum, p.bis)),
  );
  const jeKunde = new Map<string, { dauerSumme: number; dauerAnz: number; verspaetet: number; offen: number; rechnungen: number }>();
  for (const r of rows) {
    const k = r.kundeName;
    if (!jeKunde.has(k)) jeKunde.set(k, { dauerSumme: 0, dauerAnz: 0, verspaetet: 0, offen: 0, rechnungen: 0 });
    const e = jeKunde.get(k)!;
    e.rechnungen++;
    if (r.bezahltAm) {
      const dauer = Math.floor((new Date(r.bezahltAm).getTime() - new Date(r.rechnungsdatum).getTime()) / TAGE_MS);
      e.dauerSumme += dauer;
      e.dauerAnz++;
      if (r.bezahltAm > r.faelligkeitsdatum) e.verspaetet++;
    } else {
      e.offen += Number(r.brutto) - Number(r.bezahltBetrag);
    }
  }
  const zeilen: BerichtZeile[] = [...jeKunde.entries()]
    .map(([kunde, e]) => ({
      zellen: [
        kunde,
        e.rechnungen,
        e.dauerAnz > 0 ? euro(e.dauerSumme / e.dauerAnz) : null,
        e.verspaetet,
        euro(e.offen),
      ] as (string | number | null)[],
    }))
    .sort((a, b) => Number(b.zellen[4]) - Number(a.zellen[4]));
  return {
    id: "zahlungsverhalten", titel: "Zahlungsverhalten der Kunden", zeitraum: { von: p.von, bis: p.bis },
    spalten: [{ titel: "Kunde" }, { titel: "Rechnungen", rechts: true }, { titel: "Ø Zahlungsdauer (Tage)", rechts: true }, { titel: "davon verspätet", rechts: true }, { titel: "aktuell offen (€)", rechts: true }],
    zeilen,
    hinweise: ["Ø Zahlungsdauer = Rechnungsdatum → Zahlungsdatum. Sortiert nach offenem Betrag."],
  };
}

// ── 7. Kontenblatt ──────────────────────────────────────────────────────────
async function berichtKontenblatt(p: BerichtParams): Promise<Bericht> {
  if (!p.kontoId) {
    const konten = await getDb().select().from(bankAccounts);
    if (konten.length === 0) throw new Error("Kein Bankkonto vorhanden.");
    p.kontoId = konten[0].id;
  }
  const db = getDb();
  const konto = await db.query.bankAccounts.findFirst({ where: eq(bankAccounts.id, p.kontoId) });
  if (!konto) throw new Error("Bankkonto nicht gefunden.");
  const kat = await kategorienKarte();
  const rows = await db
    .select()
    .from(bankTransaktionen)
    .where(and(eq(bankTransaktionen.bankAccountId, p.kontoId), gte(bankTransaktionen.datum, p.von), lte(bankTransaktionen.datum, p.bis)))
    .orderBy(asc(bankTransaktionen.datum), asc(bankTransaktionen.id));
  // Anfangssaldo: letzter saldoNach vor dem Zeitraum, sonst Summe davor
  const [vor] = await db
    .select({ saldo: bankTransaktionen.saldoNach })
    .from(bankTransaktionen)
    .where(and(eq(bankTransaktionen.bankAccountId, p.kontoId), lte(bankTransaktionen.datum, p.von), isNotNull(bankTransaktionen.saldoNach)))
    .orderBy(desc(bankTransaktionen.datum), desc(bankTransaktionen.id))
    .limit(1);
  let saldo = vor?.saldo != null ? Number(vor.saldo) : 0;
  if (vor?.saldo == null) {
    const [agg] = await db
      .select({ summe: sql<string>`COALESCE(SUM(${bankTransaktionen.betrag}), 0)` })
      .from(bankTransaktionen)
      .where(and(eq(bankTransaktionen.bankAccountId, p.kontoId), lte(bankTransaktionen.datum, p.von)));
    saldo = Number(agg?.summe ?? 0);
  }
  const zeilen: BerichtZeile[] = [{ zellen: ["ANFANGSSALDO", "", "", "", null, null, euro(saldo)], stark: true }];
  let ein = 0, aus = 0;
  for (const t of rows) {
    const betrag = Number(t.betrag);
    saldo += betrag;
    if (betrag >= 0) ein += betrag; else aus += Math.abs(betrag);
    zeilen.push({
      zellen: [
        t.datum, t.name, t.zweck?.slice(0, 60) ?? "",
        kategorieName(t.kategorieId, new Map([...kat].map(([id, v]) => [id, v.name])), "—"),
        betrag >= 0 ? euro(betrag) : null,
        betrag < 0 ? euro(Math.abs(betrag)) : null,
        euro(saldo),
      ],
    });
  }
  return {
    id: "kontenblatt", titel: `Kontenblatt — ${konto.bezeichnung}`, zeitraum: { von: p.von, bis: p.bis },
    spalten: [{ titel: "Datum" }, { titel: "Gegenstelle" }, { titel: "Verwendungszweck" }, { titel: "Kategorie" }, { titel: "Eingang (€)", rechts: true }, { titel: "Ausgang (€)", rechts: true }, { titel: "Saldo (€)", rechts: true }],
    zeilen,
    summenZeile: ["ENDSaldo", "", "", `Σ Ein ${euro(ein)} · Σ Aus ${euro(aus)}`, null, null, euro(saldo)],
    hinweise: [`Konto: ${konto.bezeichnung}${konto.iban ? ` · ${konto.iban}` : ""}`],
  };
}

// ── 8. Liquiditäts-Vorschau ─────────────────────────────────────────────────
async function berichtVorschau(_p: BerichtParams): Promise<Bericht> {
  const db = getDb();
  const heuteS = heute();
  const ende = new Date(Date.now() + 90 * TAGE_MS).toISOString().slice(0, 10);
  const konten = await db.select().from(bankAccounts);
  let saldo = 0;
  for (const k of konten) {
    const [letzte] = await db
      .select({ saldo: bankTransaktionen.saldoNach })
      .from(bankTransaktionen)
      .where(and(eq(bankTransaktionen.bankAccountId, k.id), isNotNull(bankTransaktionen.saldoNach)))
      .orderBy(desc(bankTransaktionen.datum), desc(bankTransaktionen.id))
      .limit(1);
    const [agg] = await db
      .select({ summe: sql<string>`COALESCE(SUM(${bankTransaktionen.betrag}), 0)` })
      .from(bankTransaktionen)
      .where(eq(bankTransaktionen.bankAccountId, k.id));
    saldo += letzte?.saldo != null ? Number(letzte.saldo) : Number(agg?.summe ?? 0);
  }
  // Geplante Flüsse aus offenen Posten (Fälligkeit = Erwartungsdatum)
  const offeneRe = await db.select().from(invoices).where(
    and(eq(invoices.status, "finalisiert"), gte(invoices.faelligkeitsdatum, heuteS), lte(invoices.faelligkeitsdatum, ende)),
  );
  const offeneEin = await db.select().from(incomingInvoices).where(
    and(isNull(incomingInvoices.bezahltAm), isNotNull(incomingInvoices.faelligkeitsdatum), gte(incomingInvoices.faelligkeitsdatum, heuteS), lte(incomingInvoices.faelligkeitsdatum, ende)),
  );
  const jeWoche = new Map<string, { ein: number; aus: number }>();
  const wocheVon = (d: string) => {
    const dt = new Date(d);
    const diff = Math.floor((dt.getTime() - Date.now()) / TAGE_MS / 7);
    return Math.min(12, Math.max(0, diff));
  };
  for (const r of offeneRe) {
    const offen = Number(r.brutto) - Number(r.bezahltBetrag);
    if (offen <= 0.004) continue;
    const w = `KW ${wocheVon(r.faelligkeitsdatum) + 1}`;
    if (!jeWoche.has(w)) jeWoche.set(w, { ein: 0, aus: 0 });
    jeWoche.get(w)!.ein += offen;
  }
  for (const r of offeneEin) {
    const w = `KW ${wocheVon(r.faelligkeitsdatum!) + 1}`;
    if (!jeWoche.has(w)) jeWoche.set(w, { ein: 0, aus: 0 });
    jeWoche.get(w)!.aus += Number(r.brutto);
  }
  const zeilen: BerichtZeile[] = [{ zellen: ["Kontostand heute", null, null, euro(saldo)], stark: true }];
  let laufend = saldo;
  const wochen = [...jeWoche.keys()].sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)));
  for (const w of wochen) {
    const v = jeWoche.get(w)!;
    laufend += v.ein - v.aus;
    zeilen.push({
      zellen: [w, euro(v.ein), euro(v.aus), euro(laufend)],
      stark: laufend < 0,
    });
  }
  return {
    id: "liquiditaets-vorschau", titel: "Liquiditäts-Vorschau (90 Tage)", zeitraum: { von: heuteS, bis: ende },
    spalten: [{ titel: "Woche" }, { titel: "gepl. Eingänge (€)", rechts: true }, { titel: "gepl. Ausgänge (€)", rechts: true }, { titel: "Projizierter Stand (€)", rechts: true }],
    zeilen,
    summenZeile: ["Projizierter Stand nach 90 Tagen", null, null, euro(laufend)],
    hinweise: [
      "Basis: offene Ausgangsrechnungen (Erwartung zum Fälligkeitsdatum) + offene Eingangsrechnungen.",
      "Fette Zeilen = projizierter negativer Stand (Liquiditätsengpass). Keine Szenarien — die ist die Basis-Projektion (Qonto/Agicap bieten darüber hinaus Was-wäre-wenn-Overlays).",
    ],
  };
}

// ── 9. SumUp-Gebühren ───────────────────────────────────────────────────────
async function berichtSumupGebuehren(p: BerichtParams): Promise<Bericht> {
  const db = getDb();
  const konten = await db.select().from(bankAccounts);
  const sumupIds = konten.filter((k) => k.iban?.startsWith("IE10SUMU") || /sumup/i.test(k.bezeichnung)).map((k) => k.id);
  const bedingung = sumupIds.length
    ? sql`(${bankTransaktionen.bankAccountId} IN (${sql.join(sumupIds.map((id) => sql`${id}`), sql`, `)}) OR ${bankTransaktionen.name} LIKE '%SumUp%')`
    : sql`${bankTransaktionen.name} LIKE '%SumUp%'`;
  const rows = await db
    .select()
    .from(bankTransaktionen)
    .where(and(bedingung, gte(bankTransaktionen.datum, p.von), lte(bankTransaktionen.datum, p.bis)))
    .orderBy(asc(bankTransaktionen.datum));
  const jeMonat = new Map<string, { auszahlung: number; gebuehr: number; anzahl: number }>();
  for (const t of rows) {
    const m = t.datum.slice(0, 7);
    if (!jeMonat.has(m)) jeMonat.set(m, { auszahlung: 0, gebuehr: 0, anzahl: 0 });
    const e = jeMonat.get(m)!;
    e.auszahlung += Number(t.betrag);
    e.gebuehr += Number(t.gebuehr ?? 0);
    e.anzahl++;
  }
  const zeilen: BerichtZeile[] = [...jeMonat.entries()].sort().map(([monat, e]) => {
    const brutto = e.auszahlung + e.gebuehr;
    return {
      zellen: [monat, e.anzahl, euro(brutto), euro(e.gebuehr), euro(e.auszahlung), brutto > 0 ? `${((e.gebuehr / brutto) * 100).toFixed(2)} %` : "—"],
    };
  });
  const gAus = rows.reduce((s, t) => s + Number(t.betrag), 0);
  const gGeb = rows.reduce((s, t) => s + Number(t.gebuehr ?? 0), 0);
  return {
    id: "sumup-gebuehren", titel: "SumUp-Gebühren", zeitraum: { von: p.von, bis: p.bis },
    spalten: [{ titel: "Monat" }, { titel: "Buchungen", rechts: true }, { titel: "Umsatz brutto (€)", rechts: true }, { titel: "Gebühren (€)", rechts: true }, { titel: "Ausgezahlt (€)", rechts: true }, { titel: "eff. Gebührensatz", rechts: true }],
    zeilen,
    summenZeile: ["Gesamt", rows.length, euro(gAus + gGeb), euro(gGeb), euro(gAus), gAus + gGeb > 0 ? `${((gGeb / (gAus + gGeb)) * 100).toFixed(2)} %` : "—"],
    hinweise: ["Brutto = Auszahlung + Gebühr. Quelle: importierte SumUp-Abrechnungen (CSV/PDF)."],
  };
}

// ── 10. Fehlende Belege ─────────────────────────────────────────────────────
async function berichtFehlendeBelege(p: BerichtParams): Promise<Bericht> {
  const db = getDb();
  const kat = await kategorienKarte();
  // Bankausgaben ohne Belegbezug (kategorisiert → Beleg sollte existieren)
  const bankOhne = await db.select().from(bankTransaktionen).where(
    and(
      gte(bankTransaktionen.datum, p.von), lte(bankTransaktionen.datum, p.bis),
      isNull(bankTransaktionen.invoiceId), isNull(bankTransaktionen.incomingInvoiceId),
      isNotNull(bankTransaktionen.kategorieId),
      sql`${bankTransaktionen.betrag} < 0`,
    ),
  ).orderBy(asc(bankTransaktionen.datum));
  // Belege ohne Zahlung (älter als 14 Tage — Zahlung sollte sichtbar sein)
  const stichtag = new Date(Date.now() - 14 * TAGE_MS).toISOString().slice(0, 10);
  const belegeOhneZahlung = await db.select().from(incomingInvoices).where(
    and(isNull(incomingInvoices.bezahltAm), lte(incomingInvoices.rechnungsdatum, stichtag)),
  ).orderBy(asc(incomingInvoices.rechnungsdatum));
  const zeilen: BerichtZeile[] = [];
  zeilen.push({ zellen: [`BANKAUSGABEN OHNE BELEG (${bankOhne.length})`, null, null, null], stark: true });
  for (const t of bankOhne) {
    zeilen.push({
      zellen: [t.datum, t.name, kategorieName(t.kategorieId, new Map([...kat].map(([id, v]) => [id, v.name])), "—"), euro(Math.abs(Number(t.betrag)))],
      ebene: 1,
    });
  }
  zeilen.push({ zellen: ["", null, null, null] });
  zeilen.push({ zellen: [`BELEGE OHNE ZAHLUNG (älter 14 Tage: ${belegeOhneZahlung.length})`, null, null, null], stark: true });
  for (const r of belegeOhneZahlung) {
    zeilen.push({ zellen: [r.rechnungsdatum, r.lieferantName, r.nummer, euro(Number(r.brutto))], ebene: 1 });
  }
  return {
    id: "fehlende-belege", titel: "Fehlende Belege", zeitraum: { von: p.von, bis: p.bis },
    spalten: [{ titel: "Datum" }, { titel: "Gegenstelle/Lieferant" }, { titel: "Kategorie/Nummer" }, { titel: "Betrag (€)", rechts: true }],
    zeilen,
    hinweise: [
      "GoBD-Lücke: kategorisierte Ausgaben brauchen einen Beleg (hochladen in Eingangsbelege oder per Mail → Als Beleg).",
      "Belege ohne Zahlung können berechtigt offen sein (Zahlungsziel läuft) — älter als 14 Tage = prüfen.",
    ],
  };
}

// ── 11. Ausgaben nach Kategorie ─────────────────────────────────────────────
async function berichtAusgabenKategorien(p: BerichtParams): Promise<Bericht> {
  const { reAus, bankFluesse } = await ladeFluesse(p.von, p.bis);
  const kat = await kategorienKarte();
  const jeKat = new Map<string, { summe: number; konto: string | null }>();
  const add = (id: number | null, betrag: number) => {
    const k = id !== null ? kat.get(id) : undefined;
    const name = k?.name ?? "Ohne Kategorie";
    if (!jeKat.has(name)) jeKat.set(name, { summe: 0, konto: k?.konto ?? null });
    jeKat.get(name)!.summe += betrag;
  };
  for (const r of reAus) add(r.kategorieId, Number(r.netto));
  for (const t of bankFluesse) {
    const betrag = Number(t.betrag);
    if (betrag < 0) add(t.kategorieId, Math.abs(betrag));
  }
  const gesamt = [...jeKat.values()].reduce((s, e) => s + e.summe, 0);
  const zeilen: BerichtZeile[] = [...jeKat.entries()]
    .sort((a, b) => b[1].summe - a[1].summe)
    .map(([name, e]) => ({
      zellen: [name, e.konto ?? "—", euro(e.summe), gesamt > 0 ? `${((e.summe / gesamt) * 100).toFixed(1)} %` : "—"],
    }));
  return {
    id: "ausgaben-kategorien", titel: "Ausgaben nach Kategorie", zeitraum: { von: p.von, bis: p.bis },
    spalten: [{ titel: "Kategorie" }, { titel: "SKR-Konto" }, { titel: "Summe (€)", rechts: true }, { titel: "Anteil", rechts: true }],
    zeilen,
    summenZeile: ["Gesamt", null, euro(gesamt), "100 %"],
    hinweise: ["Einfache BWA-Variante: SKR-Konten aus den Kategorien; die volle DATEV-BWA erzeugt der Steuerberater aus dem DATEV-Export."],
  };
}

// ── 12. Umsatz nach Kunde ───────────────────────────────────────────────────
async function berichtUmsatzKunden(p: BerichtParams): Promise<Bericht> {
  const db = getDb();
  const rows = await db.select().from(invoices).where(
    and(eq(invoices.status, "finalisiert"), gte(invoices.rechnungsdatum, p.von), lte(invoices.rechnungsdatum, p.bis)),
  );
  const jeKunde = new Map<string, { anzahl: number; netto: number; ust: number; brutto: number; offen: number }>();
  for (const r of rows) {
    const k = r.kundeName;
    if (!jeKunde.has(k)) jeKunde.set(k, { anzahl: 0, netto: 0, ust: 0, brutto: 0, offen: 0 });
    const e = jeKunde.get(k)!;
    e.anzahl++;
    e.netto += Number(r.netto);
    e.ust += Number(r.ust);
    e.brutto += Number(r.brutto);
    e.offen += Number(r.brutto) - Number(r.bezahltBetrag);
  }
  const zeilen: BerichtZeile[] = [...jeKunde.entries()]
    .sort((a, b) => b[1].netto - a[1].netto)
    .map(([kunde, e]) => ({
      zellen: [kunde, e.anzahl, euro(e.netto), euro(e.ust), euro(e.brutto), euro(e.offen)],
    }));
  const g = { netto: 0, ust: 0, brutto: 0, offen: 0 };
  for (const e of jeKunde.values()) { g.netto += e.netto; g.ust += e.ust; g.brutto += e.brutto; g.offen += e.offen; }
  return {
    id: "umsatz-kunden", titel: "Umsatz nach Kunde", zeitraum: { von: p.von, bis: p.bis },
    spalten: [{ titel: "Kunde" }, { titel: "Rechnungen", rechts: true }, { titel: "Netto (€)", rechts: true }, { titel: "USt (€)", rechts: true }, { titel: "Brutto (€)", rechts: true }, { titel: "davon offen (€)", rechts: true }],
    zeilen,
    summenZeile: ["Gesamt", rows.length, euro(g.netto), euro(g.ust), euro(g.brutto), euro(g.offen)],
  };
}

// ── Dispatcher ──────────────────────────────────────────────────────────────
export async function baueBericht(id: string, params: BerichtParams): Promise<Bericht> {
  pruefeZeitraum(params.von, params.bis);
  switch (id) {
    case "euer": return berichtEuer(params);
    case "steuer-ruecklage": return berichtSteuerRuecklage(params);
    case "zm": return berichtZm(params);
    case "debitoren": return berichtDebitoren(params);
    case "kreditoren": return berichtKreditoren(params);
    case "zahlungsverhalten": return berichtZahlungsverhalten(params);
    case "kontenblatt": return berichtKontenblatt(params);
    case "liquiditaets-vorschau": return berichtVorschau(params);
    case "sumup-gebuehren": return berichtSumupGebuehren(params);
    case "fehlende-belege": return berichtFehlendeBelege(params);
    case "ausgaben-kategorien": return berichtAusgabenKategorien(params);
    case "umsatz-kunden": return berichtUmsatzKunden(params);
    default: throw new Error(`Unbekannter Bericht „${id}". Katalog: GET /berichte/katalog`);
  }
}
