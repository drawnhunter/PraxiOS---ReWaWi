// ── Lädt Beleg-Daten für das PDF (geteilt zwischen Hono-Routen und tRPC) ────
import { getDb } from "./queries/connection";
import {
  invoices,
  creditNotes,
  deliveryNotes,
  purchaseOrders,
  offers,
  companySettings,
} from "@db/schema";
import { eq } from "drizzle-orm";
import type { PdfBeleg } from "./pdf";

export async function ladeFirmaLive(): Promise<PdfBeleg["firma"]> {
  const s = await getDb().query.companySettings.findFirst({
    where: eq(companySettings.id, 1),
  });
  if (!s) throw new Error("Firmen-Einstellungen fehlen — bitte zuerst hinterlegen.");
  return {
    name: s.name,
    strasse: s.strasse,
    plz: s.plz,
    ort: s.ort,
    land: s.land,
    handelsregister: s.handelsregister,
    steuernummer: s.steuernummer,
    ustIdNr: s.ustIdNr,
    email: s.email,
    telefon: s.telefon,
    webseite: s.webseite,
    fussText: s.fussText,
  };
}

function parseSnapshot<T>(json: string | null): T | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

// Design-Einstellungen (Akzentfarbe + PDF-Layout) fuer die Belegerzeugung
export async function ladeDesign(): Promise<import("./pdf").PdfDesign> {
  const { AKZENT_HEX, STANDARD_DESIGN } = await import("./pdf");
  const s = await getDb().query.companySettings.findFirst({
    where: eq(companySettings.id, 1),
  });
  if (!s) return STANDARD_DESIGN;
  const layout = (["klassisch", "modern", "kompakt"].includes(s.pdfLayout)
    ? s.pdfLayout
    : "klassisch") as import("./pdf").PdfLayoutId;
  return { layout, akzent: AKZENT_HEX[s.akzentfarbe] ?? AKZENT_HEX.neutral };
}

export async function ladeRechnungsBeleg(id: number): Promise<{ beleg: PdfBeleg; dateiname: string }> {
  const r = await getDb().query.invoices.findFirst({
    where: eq(invoices.id, id),
    with: { items: true, bankAccount: true },
  });
  if (!r) throw new Error("Rechnung nicht gefunden");
  r.items.sort((a, b) => a.position - b.position);

  const firma = parseSnapshot<PdfBeleg["firma"]>(r.firmenSnapshot) ?? (await ladeFirmaLive());
  const bank =
    parseSnapshot<PdfBeleg["bank"]>(r.bankSnapshot) ??
    (r.bankAccount?.iban
      ? {
          bankName: r.bankAccount.bankName,
          kontoinhaber: r.bankAccount.kontoinhaber,
          iban: r.bankAccount.iban,
          bic: r.bankAccount.bic,
        }
      : null);

  return {
    dateiname: r.nummer ?? `Entwurf-${r.id}`,
    beleg: {
      art: "rechnung",
      nummer: r.nummer ?? `Entwurf #${r.id}`,
      istEntwurf: r.status === "entwurf",
      datum: r.rechnungsdatum,
      faellig: r.faelligkeitsdatum,
      leistungsdatum: r.leistungsdatum,
      pdfNotiz: r.pdfNotiz,
      bezahltCent: Math.round(Number(r.bezahltBetrag) * 100),
      hauptrabattArt: r.hauptrabattArt as "prozent" | "festwert" | null,
      hauptrabattWert: r.hauptrabattWert,
      rabattAddieren: r.rabattAddieren,
      firma,
      bank,
      kunde: {
        name: r.kundeName,
        zusatz: r.kundeZusatz,
        strasse: r.kundeStrasse,
        plz: r.kundePlz,
        ort: r.kundeOrt,
        land: r.kundeLand,
      },
      items: r.items.map((it) => ({
        bezeichnung: it.bezeichnung,
        beschreibung: it.beschreibung,
        menge: it.menge,
        einheit: it.einheit,
        einzelpreis: it.einzelpreis,
        ustSatz: it.ustSatz,
        rabattArt: it.rabattArt as "prozent" | "festwert" | null,
        rabattWert: it.rabattWert,
      })),
    },
  };
}

export async function ladeGutschriftsBeleg(id: number): Promise<{ beleg: PdfBeleg; dateiname: string }> {
  const g = await getDb().query.creditNotes.findFirst({
    where: eq(creditNotes.id, id),
    with: { items: true, invoice: true },
  });
  if (!g) throw new Error("Gutschrift nicht gefunden");
  g.items.sort((a, b) => a.position - b.position);

  const firma = parseSnapshot<PdfBeleg["firma"]>(g.firmenSnapshot) ?? (await ladeFirmaLive());
  const bank = parseSnapshot<PdfBeleg["bank"]>(g.invoice.bankSnapshot) ?? null;

  return {
    dateiname: g.nummer ?? `Entwurf-${g.id}`,
    beleg: {
      art: "gutschrift",
      nummer: g.nummer ?? `Entwurf #${g.id}`,
      istEntwurf: g.status === "entwurf",
      datum: g.datum,
      referenzNummer: g.invoice.nummer,
      referenzDatum: g.invoice.rechnungsdatum,
      grund: g.grund,
      firma,
      bank,
      kunde: {
        name: g.kundeName,
        zusatz: g.kundeZusatz,
        strasse: g.kundeStrasse,
        plz: g.kundePlz,
        ort: g.kundeOrt,
        land: g.kundeLand,
      },
      items: g.items.map((it) => ({
        bezeichnung: it.bezeichnung,
        beschreibung: it.beschreibung,
        menge: it.menge,
        einheit: it.einheit,
        einzelpreis: it.einzelpreis,
        ustSatz: it.ustSatz,
      })),
    },
  };
}

export async function ladeLieferscheinBeleg(id: number): Promise<{ beleg: PdfBeleg; dateiname: string }> {
  const ls = await getDb().query.deliveryNotes.findFirst({
    where: eq(deliveryNotes.id, id),
    with: { items: true, invoice: true },
  });
  if (!ls) throw new Error("Lieferschein nicht gefunden");
  ls.items.sort((a, b) => a.position - b.position);

  const firma = parseSnapshot<PdfBeleg["firma"]>(ls.firmenSnapshot) ?? (await ladeFirmaLive());

  return {
    dateiname: ls.nummer ?? `Entwurf-${ls.id}`,
    beleg: {
      art: "lieferschein",
      nummer: ls.nummer ?? `Entwurf #${ls.id}`,
      istEntwurf: ls.status === "entwurf",
      datum: ls.datum,
      referenzNummer: ls.invoice?.nummer ?? null,
      pdfNotiz: ls.pdfNotiz,
      firma,
      bank: null,
      kunde: {
        name: ls.kundeName,
        zusatz: ls.kundeZusatz,
        strasse: ls.kundeStrasse,
        plz: ls.kundePlz,
        ort: ls.kundeOrt,
        land: ls.kundeLand,
      },
      items: ls.items.map((it) => ({
        bezeichnung: it.bezeichnung,
        beschreibung: it.beschreibung,
        menge: it.menge,
        einheit: it.einheit,
        einzelpreis: "0",
        ustSatz: 0,
      })),
    },
  };
}

export async function ladeBestellungsBeleg(id: number): Promise<{ beleg: PdfBeleg; dateiname: string }> {
  const b = await getDb().query.purchaseOrders.findFirst({
    where: eq(purchaseOrders.id, id),
    with: { items: true },
  });
  if (!b) throw new Error("Bestellung nicht gefunden");
  b.items.sort((a, b2) => a.position - b2.position);

  const firma = parseSnapshot<PdfBeleg["firma"]>(b.firmenSnapshot) ?? (await ladeFirmaLive());

  return {
    dateiname: b.nummer ?? `Entwurf-${b.id}`,
    beleg: {
      art: "bestellung",
      nummer: b.nummer ?? `Entwurf #${b.id}`,
      istEntwurf: b.status === "entwurf",
      datum: b.bestelldatum,
      lieferdatum: b.lieferdatum,
      pdfNotiz: b.pdfNotiz,
      firma,
      bank: null,
      kunde: {
        name: b.lieferantName,
        zusatz: b.lieferantZusatz,
        strasse: b.lieferantStrasse,
        plz: b.lieferantPlz,
        ort: b.lieferantOrt,
        land: b.lieferantLand,
      },
      items: b.items.map((it) => ({
        bezeichnung: it.bezeichnung,
        beschreibung: it.beschreibung,
        menge: it.menge,
        einheit: it.einheit,
        einzelpreis: it.einzelpreis,
        ustSatz: it.ustSatz,
      })),
    },
  };
}

export async function ladeAngebotsBeleg(id: number): Promise<{ beleg: PdfBeleg; dateiname: string }> {
  const a = await getDb().query.offers.findFirst({
    where: eq(offers.id, id),
    with: { items: true },
  });
  if (!a) throw new Error("Angebot nicht gefunden");
  a.items.sort((x, y) => x.position - y.position);

  const firma = parseSnapshot<PdfBeleg["firma"]>(a.firmenSnapshot) ?? (await ladeFirmaLive());

  return {
    dateiname: a.nummer ?? `Entwurf-${a.id}`,
    beleg: {
      art: "angebot",
      nummer: a.nummer ?? `Entwurf #${a.id}`,
      istEntwurf: a.status === "entwurf",
      datum: a.datum,
      gueltigBis: a.gueltigBis,
      pdfNotiz: a.pdfNotiz,
      firma,
      bank: null,
      kunde: {
        name: a.kundeName,
        zusatz: a.kundeZusatz,
        strasse: a.kundeStrasse,
        plz: a.kundePlz,
        ort: a.kundeOrt,
        land: a.kundeLand,
      },
      items: a.items.map((it) => ({
        bezeichnung: it.bezeichnung,
        beschreibung: it.beschreibung,
        menge: it.menge,
        einheit: it.einheit,
        einzelpreis: it.einzelpreis,
        ustSatz: it.ustSatz,
      })),
    },
  };
}

// Mahnung als Beleg laden (fuer PDF-Vorschau, Download und E-Mail)
export async function ladeMahnungsBeleg(id: number): Promise<{ pdf: Buffer; dateiname: string }> {
  const { renderMahnungPdf, MAHN_STUFEN } = await import("./pdf");
  const m = await getDb().query.reminders.findFirst({
    where: (t, { eq: e }) => e(t.id, id),
    with: { invoice: true },
  });
  if (!m) throw new Error("Mahnung nicht gefunden.");
  const r = m.invoice;
  const firmaSnap = r.firmenSnapshot ? JSON.parse(r.firmenSnapshot) : null;
  const firma = firmaSnap ?? (await ladeFirmaLive());
  const bankSnap = r.bankSnapshot ? JSON.parse(r.bankSnapshot) : null;
  const pdf = await renderMahnungPdf({
    stufe: m.stufe,
    datum: m.datum,
    zahlungsfrist: m.zahlungsfrist,
    offenCent: Math.round(Number(m.offenBetrag) * 100),
    bruttoCent: Math.round(Number(r.brutto) * 100),
    bezahltCent: Math.round(Number(r.bezahltBetrag) * 100),
    rechnungNummer: r.nummer ?? `#${r.id}`,
    rechnungDatum: r.rechnungsdatum,
    firma,
    bank: bankSnap ?? null,
    kunde: {
      name: r.kundeName, zusatz: r.kundeZusatz, strasse: r.kundeStrasse,
      plz: r.kundePlz, ort: r.kundeOrt, land: r.kundeLand,
    },
  });
  return { pdf, dateiname: `${MAHN_STUFEN[m.stufe] ?? "Mahnung"} ${r.nummer ?? r.id}.pdf` };
}
