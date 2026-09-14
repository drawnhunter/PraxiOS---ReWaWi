// ── DSGVO-Pseudonymisierung der Agent-API ──────────────────────────────────
// Kunden/Lieferanten erscheinen als Synonym (K-0001/L-0001), Bank-Gegenstellen
// werden gegen bekannte Stammdaten aufgelöst oder maskiert. Die Klarnamen
// bleiben im System (GoBD); die Agent-API liefert standardmäßig Pseudonyme.
import { eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { customers, suppliers, companySettings } from "@db/schema";
import { besterTreffer } from "@contracts/fuzzy";

export async function pseudonymAktiv(): Promise<boolean> {
  const s = await getDb().query.companySettings.findFirst({
    where: eq(companySettings.id, 1),
    columns: { agentPseudonym: true },
  });
  return s?.agentPseudonym !== false; // Standard: an
}

/** Synonym nach Anlage eines Stammdatensatzes vergeben (K-/L- + ID). */
export async function vergibSynonym(tabelle: "customers" | "suppliers", id: number): Promise<string> {
  const db = getDb();
  const praefix = tabelle === "customers" ? "K" : "L";
  const synonym = `${praefix}-${String(id).padStart(4, "0")}`;
  if (tabelle === "customers") {
    await db.update(customers).set({ synonym }).where(eq(customers.id, id));
  } else {
    await db.update(suppliers).set({ synonym }).where(eq(suppliers.id, id));
  }
  return synonym;
}

export interface SynonymKarte {
  aktiv: boolean;
  kunden: Map<number, string>;
  lieferanten: Map<number, string>;
  namen: { id: number; name: string; synonym: string; art: "kunde" | "lieferant" }[];
}

let cache: { karte: SynonymKarte; zeit: number } | null = null;
const CACHE_MS = 30_000;

export async function ladeSynonymKarte(): Promise<SynonymKarte> {
  if (cache && Date.now() - cache.zeit < CACHE_MS) return cache.karte;
  const aktiv = await pseudonymAktiv();
  const db = getDb();
  const [k, l] = await Promise.all([
    db.select({ id: customers.id, name: customers.name, synonym: customers.synonym }).from(customers),
    db.select({ id: suppliers.id, name: suppliers.name, synonym: suppliers.synonym }).from(suppliers),
  ]);
  const karte: SynonymKarte = {
    aktiv,
    kunden: new Map(k.map((x) => [x.id, x.synonym ?? `K-${String(x.id).padStart(4, "0")}`])),
    lieferanten: new Map(l.map((x) => [x.id, x.synonym ?? `L-${String(x.id).padStart(4, "0")}`])),
    namen: [
      ...k.map((x) => ({ id: x.id, name: x.name, synonym: x.synonym ?? "", art: "kunde" as const })),
      ...l.map((x) => ({ id: x.id, name: x.name, synonym: x.synonym ?? "", art: "lieferant" as const })),
    ],
  };
  cache = { karte, zeit: Date.now() };
  return karte;
}

export function pseudonymCacheLeeren() {
  cache = null;
}

/** Anzeigename für die Agent-API: Synonym wenn aktiv, sonst Klarname. */
export function agentName(karte: SynonymKarte, kundenId: number | null, klarname: string): string {
  if (!karte.aktiv || kundenId === null) return klarname;
  return karte.kunden.get(kundenId) ?? klarname;
}

/** Bank-Gegenstelle: bekannte Stammdaten → Synonym; unbekannt → maskiert. */
export function maskiereGegenstelle(karte: SynonymKarte, name: string): string {
  if (!karte.aktiv) return name;
  const t = besterTreffer(karte.namen, name, (x) => x.name, 80);
  if (t) return t.treffer.synonym || (t.treffer.art === "kunde" ? `K-${String(t.treffer.id).padStart(4, "0")}` : `L-${String(t.treffer.id).padStart(4, "0")}`);
  // Unbekannt: Anfang kürzen, Rest maskieren (kein Re-Identifikations-Anker)
  const sauber = name.trim().replace(/\s+/g, " ");
  return sauber.length <= 5 ? sauber : `${sauber.slice(0, 5)}…`;
}

/** Lieferantenname → Synonym (Eingangsbelege). */
export function agentLieferant(karte: SynonymKarte, klarname: string): string {
  if (!karte.aktiv) return klarname;
  const t = besterTreffer(karte.namen.filter((x) => x.art === "lieferant"), klarname, (x) => x.name, 80);
  return t ? t.treffer.synonym || klarname : maskiereGegenstelle(karte, klarname);
}
