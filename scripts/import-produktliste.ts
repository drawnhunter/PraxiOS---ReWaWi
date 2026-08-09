// Einmal-Import der Apotheken-Produktliste in den Katalog.
// Auf dem Server ausfuehren:  docker compose exec app npx tsx scripts/import-produktliste.ts
// Idempotent: vorhandene Namen werden uebersprungen.
import { getDb } from "../api/queries/connection";
import { products } from "../db/schema";
import * as fs from "fs";

const pfad = process.argv[2] ?? "data/produktliste-ek.csv";
const csv = fs.readFileSync(pfad, "utf8");
const zeilen = csv.split(/\r?\n/).slice(1).filter((z) => z.trim());
const db = getDb();
const vorhanden = await db.select().from(products);
const namenDa = new Map(vorhanden.map((p) => [p.name.toLowerCase(), p]));

const KATEGORIEN_LAGER = new Set([
  "Infusionen", "Apothekenstoffe", "Einmalmaterial", "Geräte-Sets",
  "Naturprodukte", "Homöopathika", "OTC", "Pflege", "Gase",
]);

let neu = 0, doppelt = 0;
for (const z of zeilen) {
  const f = z.split(";");
  const [name, code, einheit, ek, lieferant, kategorie] = f;
  if (!name) continue;
  const ekN = Number(ek.replace(",", "."));
  if (namenDa.has(name.toLowerCase())) { doppelt++; continue; }
  const lager = KATEGORIEN_LAGER.has(kategorie);
  await db.insert(products).values({
    name,
    artikelnummer: code || null,
    barcode: code && /^\d{7,8}$/.test(code) ? code : null,
    beschreibung: `EK ${ek} netto (${lieferant}, Stand ${f[6]})`,
    einheit: einheit === "Pack" ? "Packung" : einheit.split(" ")[0] || "Stück",
    preisNetto: ekN.toFixed(2),
    ekPreisNetto: ekN.toFixed(2),
    kategorie,
    lagerAktiv: lager,
    ustSatz: 19,
  });
  neu++;
}
console.log(`Importiert: ${neu}, uebersprungen (vorhanden): ${doppelt}`);
process.exit(0);
