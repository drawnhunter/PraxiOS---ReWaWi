// ── Nutzungsnachweis-Import (Spezifikation v1.0) ───────────────────────────
// Aggregierte Verbrauchsdaten aus der Arzt-Sphaere (raum/maschine/therapie/
// material/personal) -> Rechnungsentwurf an den Arzt. Patientenanonym.
import { z } from "zod";
import Papa from "papaparse";
import { eq } from "drizzle-orm";
import { authedQuery, createRouter } from "./middleware";
import { getDb } from "./queries/connection";
import { invoices, invoiceItems, customers, products, bankAccounts } from "@db/schema";
import { computeTotals, centToDecimal } from "@contracts/invoicing";

function parseCsv(csvText: string): Record<string, string>[] {
  const res = Papa.parse<Record<string, string>>(csvText.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
    transform: (v) => (typeof v === "string" ? v.trim() : v),
  });
  return res.data.filter((row) =>
    Object.values(row).some((v) => v && v.trim() !== ""),
  );
}

function mengeLesen(roh: string): number | null {
  const s = roh.replace(",", ".").replace(/[^\d.-]/g, "");
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function kwEnde(zeitraum: string): string {
  // „27.07.-31.07.2026" -> Enddatum; „2026-KW31" -> Sonntag der KW
  const m = zeitraum.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})\s*$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const kw = zeitraum.match(/(\d{4})\s*-?\s*KW\s*(\d{1,2})/i);
  if (kw) {
    const jahr = Number(kw[1]);
    const woche = Number(kw[2]);
    const jan4 = new Date(Date.UTC(jahr, 0, 4));
    const montagKw1 = new Date(jan4);
    montagKw1.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7));
    const sonntag = new Date(montagKw1);
    sonntag.setUTCDate(montagKw1.getUTCDate() + (woche - 1) * 7 + 6);
    return sonntag.toISOString().slice(0, 10);
  }
  return new Date().toISOString().slice(0, 10);
}

interface NachweisZeile {
  typ: string;
  code: string;
  bezeichnung: string;
  menge: number;
  einheit: string;
  bemerkung: string;
}

interface Gruppe {
  zeitraum: string;
  arzt: string;
  customerId: number | null;
  kundeName: string | null;
  positionen: {
    bezeichnung: string;
    menge: string;
    einheit: string;
    einzelpreis: string;
    ustSatz: number;
    gematcht: boolean;
    quelle?: string;
  }[];
  warnungen: string[];
  bruttoCent: number;
}

async function analysieren(rows: Record<string, string>[]): Promise<Gruppe[]> {
  const db = getDb();
  const gruppen = new Map<string, NachweisZeile[]>();
  for (const row of rows) {
    const schluessel = `${row["zeitraum"] ?? "?"}|||${row["arzt"] ?? "?"}`;
    if (!gruppen.has(schluessel)) gruppen.set(schluessel, []);
    const menge = mengeLesen(row["menge"] ?? "");
    if (!menge) continue;
    gruppen.get(schluessel)!.push({
      typ: (row["typ"] ?? "").toLowerCase(),
      code: (row["code"] ?? "").trim(),
      bezeichnung: (row["bezeichnung"] ?? "").trim(),
      menge,
      einheit: (row["einheit"] ?? "Stück").trim(),
      bemerkung: (row["bemerkung"] ?? "").trim(),
    });
  }

  const kundenListe = await db.select().from(customers);
  const produktListe = await db.select().from(products);

  const ausgabe: Gruppe[] = [];
  for (const [schluessel, zeilen] of gruppen) {
    const [zeitraum, arzt] = schluessel.split("|||");
    const warnungen: string[] = [];

    const kunde =
      kundenListe.find((k) => k.name.toLowerCase() === arzt.toLowerCase()) ??
      kundenListe.find((k) => k.name.toLowerCase().includes(arzt.toLowerCase()));
    if (!kunde) warnungen.push(`Arzt „${arzt}" nicht im Kundenstamm — bitte zuerst als Kunde anlegen.`);

    const positionen: Gruppe["positionen"] = [];
    for (const z of zeilen) {
      let produkt = z.code
        ? produktListe.find((p) => p.artikelnummer?.toLowerCase() === z.code.toLowerCase())
        : undefined;
      produkt ??= produktListe.find(
        (p) => p.name.toLowerCase() === z.bezeichnung.toLowerCase(),
      );

      if (!produkt) {
        warnungen.push(`„${z.bezeichnung}"${z.code ? ` (${z.code})` : ""} nicht im Produktkatalog — Preis 0, bitte nachpflegen.`);
        positionen.push({
          bezeichnung: z.bemerkung ? `${z.bezeichnung} (${z.bemerkung})` : z.bezeichnung,
          menge: String(z.menge).replace(".", ","),
          einheit: z.einheit,
          einzelpreis: "0.00",
          ustSatz: 19,
          gematcht: false,
        });
        continue;
      }

      let preis = produkt.preisNetto;
      let quelle = "standard";
      if (kunde) {
        const r = await db.query.konditionen.findFirst({
          where: (k, { eq: e, and: a }) =>
            a(e(k.typ, "kunde"), e(k.partnerId, kunde.id), e(k.productId, produkt!.id)),
        });
        if (r) { preis = r.preisNetto; quelle = "kondition"; }
      }
      positionen.push({
        bezeichnung: z.bemerkung ? `${produkt.name} (${z.bemerkung})` : produkt.name,
        menge: String(z.menge).replace(".", ","),
        einheit: z.einheit || produkt.einheit,
        einzelpreis: preis,
        ustSatz: produkt.ustSatz,
        gematcht: true,
        quelle,
      });
    }

    const totals = computeTotals(positionen.map((p) => ({ ...p, beschreibung: null })));
    ausgabe.push({
      zeitraum,
      arzt,
      customerId: kunde?.id ?? null,
      kundeName: kunde?.name ?? null,
      positionen,
      warnungen,
      bruttoCent: totals.bruttoCent,
    });
  }
  return ausgabe;
}

export const nachweisRouter = createRouter({
  vorschau: authedQuery
    .input(z.object({ csvText: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const rows = parseCsv(input.csvText);
      if (rows.length === 0) throw new Error("Keine Datenzeilen gefunden — Format gemäß Spezifikation (Semikolon, Kopfzeile zeitraum;arzt;typ;code;…)?");
      const gruppen = await analysieren(rows);
      return {
        gruppen,
        gesamt: gruppen.length,
        warnungen: gruppen.reduce((a, g) => a + g.warnungen.length, 0),
      };
    }),

  importieren: authedQuery
    .input(z.object({ csvText: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const gruppen = await analysieren(parseCsv(input.csvText));
      const standardBank = await db.query.bankAccounts.findFirst({
        where: eq(bankAccounts.istStandard, true),
      });

      const erstellt: { id: number; zeitraum: string; arzt: string }[] = [];
      for (const g of gruppen) {
        if (!g.customerId) continue; // ohne Kundenstamm kein Entwurf
        const kunde = await db.query.customers.findFirst({
          where: eq(customers.id, g.customerId),
        });
        const totals = computeTotals(g.positionen.map((p) => ({ ...p, beschreibung: null })));
        const datum = kwEnde(g.zeitraum);
        const ziel = kunde?.zahlungszielTage ?? 14;
        const faellig = new Date(datum + "T00:00:00Z");
        faellig.setUTCDate(faellig.getUTCDate() + ziel);

        const [res] = await db.insert(invoices).values({
          customerId: g.customerId,
          status: "entwurf",
          rechnungsdatum: datum,
          faelligkeitsdatum: faellig.toISOString().slice(0, 10),
          kundeName: kunde!.name,
          kundeZusatz: kunde!.zusatz,
          kundeStrasse: kunde!.strasse,
          kundePlz: kunde!.plz,
          kundeOrt: kunde!.ort,
          kundeLand: kunde!.land,
          netto: centToDecimal(totals.nettoCent),
          ust: centToDecimal(totals.ustCent),
          brutto: centToDecimal(totals.bruttoCent),
          bezahltBetrag: "0",
          bankAccountId: standardBank?.id ?? null,
          bemerkung: `Nutzungsnachweis ${g.zeitraum}`,
        }).$returningId();

        await db.insert(invoiceItems).values(
          g.positionen.map((p, i) => ({
            invoiceId: res.id,
            position: i + 1,
            bezeichnung: p.bezeichnung,
            menge: p.menge.replace(",", "."),
            einheit: p.einheit,
            einzelpreis: p.einzelpreis,
            ustSatz: p.ustSatz,
          })),
        );
        erstellt.push({ id: res.id, zeitraum: g.zeitraum, arzt: g.arzt });
      }
      return {
        erstellt,
        uebersprungen: gruppen.filter((g) => !g.customerId).map((g) => g.arzt),
      };
    }),
});
