import { sql } from "drizzle-orm";
import { getDb } from "../queries/connection";

/**
 * Selbstheilung der Nummernkreise beim Boot (GoBD-Schutz):
 * Liegt der gespeicherte Zählerstand hinter der höchsten real vergebenen
 * Nummer zurück (z. B. nach Altbestand-Import oder Reparatur-Eingriff),
 * wird der Zähler angehoben. Niemals absenken — GREATEST im UPSERT.
 *
 * Kreise und Nummernformate (müssen zu den format*-Funktionen passen):
 *  - invoice:        "2026-003"   (jahr aus Präfix)
 *  - offer:          "A-2026-003"
 *  - delivery_note:  "LS-2026-003"
 *  - purchase_order: "B-2026-003"
 *  - credit_note:    "ST/0001"    (jahresunabhängig, jahr = 0)
 */
const KREISE: {
  typ: string;
  tabelle: string;
  muster: string;
  jahrExpr: string;
  nExpr: string;
}[] = [
  {
    typ: "invoice",
    tabelle: "invoices",
    muster: "^[0-9]{4}-[0-9]{3,}$",
    jahrExpr: "CAST(SUBSTRING(nummer, 1, 4) AS UNSIGNED)",
    nExpr: "CAST(SUBSTRING_INDEX(nummer, '-', -1) AS UNSIGNED)",
  },
  {
    typ: "offer",
    tabelle: "offers",
    muster: "^A-[0-9]{4}-[0-9]{3,}$",
    jahrExpr: "CAST(SUBSTRING(nummer, 3, 4) AS UNSIGNED)",
    nExpr: "CAST(SUBSTRING_INDEX(nummer, '-', -1) AS UNSIGNED)",
  },
  {
    typ: "delivery_note",
    tabelle: "delivery_notes",
    muster: "^LS-[0-9]{4}-[0-9]{3,}$",
    jahrExpr: "CAST(SUBSTRING(nummer, 4, 4) AS UNSIGNED)",
    nExpr: "CAST(SUBSTRING_INDEX(nummer, '-', -1) AS UNSIGNED)",
  },
  {
    typ: "purchase_order",
    tabelle: "purchase_orders",
    muster: "^B-[0-9]{4}-[0-9]{3,}$",
    jahrExpr: "CAST(SUBSTRING(nummer, 3, 4) AS UNSIGNED)",
    nExpr: "CAST(SUBSTRING_INDEX(nummer, '-', -1) AS UNSIGNED)",
  },
  {
    typ: "credit_note",
    tabelle: "credit_notes",
    muster: "^ST/[0-9]{4,}$",
    jahrExpr: "0",
    nExpr: "CAST(SUBSTRING_INDEX(nummer, '/', -1) AS UNSIGNED)",
  },
];

export async function heileNummernkreise(): Promise<void> {
  const db = getDb();
  for (const k of KREISE) {
    try {
      // Alle Bestandteile sind feste Konstanten aus KREISE — keine Nutzereingaben.
      const [zeilen] = (await db.execute(
        sql.raw(
          `SELECT ${k.jahrExpr} AS jahr, MAX(${k.nExpr}) AS maxn ` +
            `FROM ${k.tabelle} WHERE nummer REGEXP '${k.muster}' GROUP BY jahr`,
        ),
      )) as unknown as [{ jahr: number | string; maxn: number | string | null }[], unknown];

      for (const z of zeilen) {
        const maxn = Number(z.maxn ?? 0);
        const jahr = Number(z.jahr);
        if (!Number.isFinite(maxn) || maxn <= 0 || !Number.isFinite(jahr)) continue;
        await db.execute(
          sql.raw(
            `INSERT INTO number_sequences (typ, jahr, letzte_nummer) ` +
              `VALUES ('${k.typ}', ${jahr}, ${maxn}) ` +
              `ON DUPLICATE KEY UPDATE letzte_nummer = GREATEST(letzte_nummer, ${maxn})`,
          ),
        );
      }
    } catch (e) {
      // Ein Kreis darf die anderen nicht blockieren (z. B. Tabelle existiert noch nicht)
      console.error(`[nummernkreise] Heilung für ${k.typ} fehlgeschlagen:`, e);
    }
  }
}
