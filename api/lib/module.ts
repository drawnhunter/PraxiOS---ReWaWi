// ── Modul-Konfiguration (Feature-Flags, kein Runtime-Plugin-Loader) ────────
// Alle Module liegen im Release (signiert, getestet). Instanzen schalten per
// Klick um — Sidebar, tRPC-Gate und Einstellungen lesen dieselbe Konfig.
import { eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { companySettings } from "@db/schema";

export interface ModulDef {
  id: string;
  titel: string;
  beschreibung: string;
  /** tRPC-Router-Präfixe, die zum Modul gehören (Gate-Match). */
  router: string[];
}

/** Die schaltbaren Module (Reihenfolge = Anzeige in Einstellungen). */
export const MODUL_DEFS: ModulDef[] = [
  {
    id: "zeiterfassung",
    titel: "Zeiterfassung",
    beschreibung: "Stempeln, Freigaben, Monatsauswertung, Stunden→Rechnung",
    router: ["zeit"],
  },
  {
    id: "banking",
    titel: "Banking",
    beschreibung: "Kontoauszug-Import (CSV/PDF), Zuordnung, Kontoauszug-PDF",
    router: ["bank", "bankTrans"],
  },
  {
    id: "postmanager",
    titel: "Post Manager",
    beschreibung: "Scan-Import, lokale OCR, Regelwerk, Beleg-Digitalisierung",
    router: ["posteingang", "magicImport"],
  },
  {
    id: "lager",
    titel: "Lager",
    beschreibung: "Bestände, Mindestbestände, Inventur, Handy-Scan, Etiketten",
    router: ["lager"],
  },
];

export type ModulKonfig = Record<string, boolean>;

let cache: { konfig: ModulKonfig; zeit: number } | null = null;
const CACHE_MS = 30_000;

/** Aktuelle Modul-Konfig (JSON aus company_settings; null = alles aktiv). */
export async function ladeModulKonfig(): Promise<ModulKonfig> {
  if (cache && Date.now() - cache.zeit < CACHE_MS) return cache.konfig;
  const s = await getDb().query.companySettings.findFirst({
    where: eq(companySettings.id, 1),
    columns: { modulKonfig: true },
  });
  let konfig: ModulKonfig = {};
  if (s?.modulKonfig) {
    try {
      konfig = JSON.parse(s.modulKonfig) as ModulKonfig;
    } catch { /* defektes JSON = alles aktiv */ }
  }
  cache = { konfig, zeit: Date.now() };
  return konfig;
}

export function modulCacheLeeren() {
  cache = null;
}

/** Ist ein Modul aktiv? (Standard: ja — rückwärtskompatibel.) */
export async function modulAktiv(id: string): Promise<boolean> {
  const konfig = await ladeModulKonfig();
  return konfig[id] !== false;
}

/** Gate für einen tRPC-Router-Präfix: liefert Modul-ID oder null (Kern). */
export function modulFuerRouter(routerName: string): ModulDef | null {
  for (const def of MODUL_DEFS) {
    if (def.router.includes(routerName)) return def;
  }
  return null;
}
