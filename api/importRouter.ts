import { z } from "zod";
import Papa from "papaparse";
import { authedQuery, createRouter } from "./middleware";
import { getDb } from "./queries/connection";
import { customers, products } from "@db/schema";
import { eq, and } from "drizzle-orm";

// ── CSV-Basis: BOM entfernen, Delimiter auto-erkennen, Quotes/Multiline ────
function parseCsv(csvText: string): Record<string, string>[] {
  const text = csvText.replace(/^﻿/, "");
  const res = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
    transform: (v) => (typeof v === "string" ? v.trim() : v),
  });
  return res.data.filter((row) =>
    Object.values(row).some((v) => v && v.trim() !== ""),
  );
}

const LAENDER: Record<string, string> = {
  DE: "Deutschland",
  CH: "Schweiz",
  AT: "Österreich",
  NL: "Niederlande",
  BE: "Belgien",
  FR: "Frankreich",
  IT: "Italien",
  ES: "Spanien",
  PL: "Polen",
  CZ: "Tschechien",
  DK: "Dänemark",
  SE: "Schweden",
  NO: "Norwegen",
  GB: "Vereinigtes Königreich",
  UK: "Vereinigtes Königreich",
  US: "USA",
};

// ── Kunden (SumUp-Kundenexport) ─────────────────────────────────────────────
export interface KundeImport {
  name: string;
  strasse: string;
  plz: string;
  ort: string;
  land: string;
  email: string | null;
  telefon: string | null;
  ustIdNr: string | null;
  zahlungszielTage: number | null;
  warnung: string | null;
}

function parseKundenZeilen(rows: Record<string, string>[]): KundeImport[] {
  return rows.map((row) => {
    const name = row["Name"] ?? "";
    const adresseRoh = (row["Adresse"] ?? "").trim();
    let strasse = "";
    let plz = "";
    let ort = "";
    let warnung: string | null = null;

    if (adresseRoh) {
      const zeilen = adresseRoh
        .split(/\r?\n/)
        .map((z) => z.trim())
        .filter(Boolean);
      const plzIdx = zeilen.findIndex((z) => /^(\d{4,6})\s+/.test(z));
      if (plzIdx >= 0) {
        const m = zeilen[plzIdx].match(/^(\d{4,6})\s+(.+)$/);
        plz = m?.[1] ?? "";
        ort = m?.[2] ?? "";
        strasse = zeilen.slice(0, plzIdx).join(", ");
        // etwaige Zeilen nach PLZ/Ort (z. B. Land) anhängen
        if (zeilen.length > plzIdx + 1) {
          const rest = zeilen.slice(plzIdx + 1).join(", ");
          if (rest && !/^(deutschland|germany)$/i.test(rest)) {
            ort = `${ort}, ${rest}`;
          }
        }
      } else {
        strasse = zeilen.join(", ");
        warnung = "PLZ/Ort nicht erkannt — bitte nach dem Import prüfen";
      }
    }

    const code = (row["Ländercode"] ?? "").toUpperCase();
    const land = row["Land"] || LAENDER[code] || (code ? code : "Deutschland");

    let zahlungszielTage: number | null = null;
    const zb = row["Zahlungsbedingungen"] ?? "";
    const zm = zb.match(/(\d+)/);
    if (zm) zahlungszielTage = Number(zm[1]);
    else if (/sofort/i.test(zb)) zahlungszielTage = 0;

    if (!name) warnung = "Name fehlt — Zeile wird übersprungen";
    if (name && (!plz || !ort) && !warnung) {
      warnung = "Adresse unvollständig — bitte prüfen";
    }

    return {
      name,
      strasse: strasse || "—",
      plz: plz || "—",
      ort: ort || "—",
      land,
      email: row["E-Mail"] || null,
      telefon: row["Telefon"] || null,
      ustIdNr: row["USt.-IdNr."] || null,
      zahlungszielTage,
      warnung,
    };
  });
}

// ── Produkte (SumUp-Artikelexport) ──────────────────────────────────────────
export interface ProduktImport {
  name: string;
  beschreibung: string | null;
  einheit: string;
  preisNetto: string;
  ustSatz: number;
  warnung: string | null;
}

const EINHEIT_MAP: Record<string, string> = {
  "each.each": "Stück",
  "hour.hour": "Stunde",
  "day.day": "Tag",
  "month.month": "Monat",
  "set.set": "Set",
  "piece.piece": "Stück",
};

function parseProduktZeilen(rows: Record<string, string>[]): ProduktImport[] {
  return rows.map((row) => {
    const name = row["Item name"] ?? row["Name"] ?? "";
    const preisRoh = (row["Price"] ?? "").replace(",", ".");
    const taxRoh = (row["Tax rate (%)"] ?? "19").replace(",", ".");
    let ustSatz = Math.round(Number(taxRoh) || 19);
    let warnung: string | null = null;

    if (![19, 7, 0].includes(ustSatz)) {
      warnung = `USt-Satz ${taxRoh} % nicht unterstützt — auf 19 % gesetzt`;
      ustSatz = 19;
    }
    if (!name) warnung = "Name fehlt — Zeile wird übersprungen";
    if (!/^\d+(\.\d{1,2})?$/.test(preisRoh)) {
      warnung = `Preis „${row["Price"]}“ nicht lesbar — Zeile wird übersprungen`;
    }

    const einheitRoh = (row["Unit"] ?? "").toLowerCase();
    const einheit = EINHEIT_MAP[einheitRoh] ?? "Stück";

    return {
      name,
      beschreibung:
        row["Description (Online Store and Invoices only)"] ||
        row["Description"] ||
        null,
      einheit,
      preisNetto: /^\d+(\.\d{1,2})?$/.test(preisRoh) ? Number(preisRoh).toFixed(2) : "0",
      ustSatz,
      warnung,
    };
  });
}

const csvInput = z.object({ csvText: z.string().min(1) });

export const importRouter = createRouter({
  previewKunden: authedQuery.input(csvInput).query(({ input }) => {
    const zeilen = parseKundenZeilen(parseCsv(input.csvText));
    return {
      gesamt: zeilen.length,
      gueltig: zeilen.filter((z) => z.name).length,
      mitWarnung: zeilen.filter((z) => z.warnung).length,
      vorschau: zeilen.slice(0, 8),
    };
  }),

  importKunden: authedQuery.input(csvInput).mutation(async ({ input }) => {
    const db = getDb();
    const zeilen = parseKundenZeilen(parseCsv(input.csvText));
    let importiert = 0;
    let uebersprungen = 0;
    const fehler: string[] = [];

    for (const z of zeilen) {
      if (!z.name) {
        uebersprungen++;
        continue;
      }
      const dup = await db.query.customers.findFirst({
        where: and(eq(customers.name, z.name), eq(customers.plz, z.plz)),
      });
      if (dup) {
        uebersprungen++;
        fehler.push(`„${z.name}“ existiert bereits — übersprungen`);
        continue;
      }
      await db.insert(customers).values({
        name: z.name,
        strasse: z.strasse,
        plz: z.plz,
        ort: z.ort,
        land: z.land,
        email: z.email,
        telefon: z.telefon,
        ustIdNr: z.ustIdNr,
        zahlungszielTage: z.zahlungszielTage,
      });
      importiert++;
    }
    return { importiert, uebersprungen, fehler: fehler.slice(0, 20) };
  }),

  previewProdukte: authedQuery.input(csvInput).query(({ input }) => {
    const zeilen = parseProduktZeilen(parseCsv(input.csvText));
    return {
      gesamt: zeilen.length,
      gueltig: zeilen.filter((z) => z.name && !z.warnung?.includes("Preis")).length,
      mitWarnung: zeilen.filter((z) => z.warnung).length,
      vorschau: zeilen.slice(0, 8),
    };
  }),

  importProdukte: authedQuery.input(csvInput).mutation(async ({ input }) => {
    const db = getDb();
    const zeilen = parseProduktZeilen(parseCsv(input.csvText));
    let importiert = 0;
    let uebersprungen = 0;
    const fehler: string[] = [];

    for (const z of zeilen) {
      if (!z.name || z.warnung?.includes("Preis")) {
        uebersprungen++;
        continue;
      }
      const dup = await db.query.products.findFirst({
        where: eq(products.name, z.name),
      });
      if (dup) {
        uebersprungen++;
        fehler.push(`„${z.name}“ existiert bereits — übersprungen`);
        continue;
      }
      await db.insert(products).values({
        name: z.name,
        beschreibung: z.beschreibung,
        einheit: z.einheit,
        preisNetto: z.preisNetto,
        ustSatz: z.ustSatz,
      });
      importiert++;
    }
    return { importiert, uebersprungen, fehler: fehler.slice(0, 20) };
  }),
});
