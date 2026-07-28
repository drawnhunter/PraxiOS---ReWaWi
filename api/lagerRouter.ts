// ── Lagerbestand ───────────────────────────────────────────────────────────
// Bestand = Summe aller Bewegungen je Produkt (auditfest). Dubletten/
// Preisvergleich: gleiche normalisierte Namen oder Artikelnummern mit
// unterschiedlichen Preisen/Lieferanten als Signal.
import { z } from "zod";
import { authedQuery, createRouter } from "./middleware";
import { getDb } from "./queries/connection";
import { products, lagerBewegungen, konditionen, suppliers } from "@db/schema";
import { eq, desc, sql } from "drizzle-orm";

function normalisiereName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[×*]/g, "x")
    .replace(/[^a-z0-9äöüß]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const lagerRouter = createRouter({
  // Bestand aller lagerfuehrenden Produkte (Summe der Bewegungen)
  bestand: authedQuery.query(async () => {
    const db = getDb();
    const summen = await db
      .select({
        productId: lagerBewegungen.productId,
        summe: sql<string>`COALESCE(SUM(${lagerBewegungen.menge}), 0)`,
      })
      .from(lagerBewegungen)
      .groupBy(lagerBewegungen.productId);
    const proZeile = new Map(summen.map((s) => [s.productId, Number(s.summe)]));

    const liste = await db
      .select()
      .from(products)
      .where(eq(products.lagerAktiv, true));
    return liste
      .map((p) => ({
        id: p.id,
        name: p.name,
        artikelnummer: p.artikelnummer,
        barcode: p.barcode,
        kategorie: p.kategorie,
        einheit: p.einheit,
        ekPreisNetto: p.ekPreisNetto,
        mindestbestand: p.mindestbestand ? Number(p.mindestbestand) : null,
        bestand: proZeile.get(p.id) ?? 0,
        niedrig:
          p.mindestbestand !== null &&
          Number(p.mindestbestand) > 0 &&
          (proZeile.get(p.id) ?? 0) <= Number(p.mindestbestand),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "de"));
  }),

  // Bewegung buchen (zugang/abgang; korrektur/inventur setzt absoluten Bestand)
  buchen: authedQuery
    .input(
      z.object({
        productId: z.number(),
        typ: z.enum(["zugang", "abgang", "korrektur", "inventur"]),
        menge: z.number().positive(),
        datum: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        bemerkung: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const p = await db.query.products.findFirst({
        where: eq(products.id, input.productId),
      });
      if (!p) throw new Error("Produkt nicht gefunden.");

      let delta = input.menge;
      if (input.typ === "abgang") delta = -input.menge;
      if (input.typ === "korrektur" || input.typ === "inventur") {
        const [akt] = await db
          .select({ summe: sql<string>`COALESCE(SUM(${lagerBewegungen.menge}), 0)` })
          .from(lagerBewegungen)
          .where(eq(lagerBewegungen.productId, input.productId));
        delta = input.menge - Number(akt.summe);
      }
      await db.insert(lagerBewegungen).values({
        productId: input.productId,
        typ: input.typ,
        menge: delta.toFixed(2),
        datum: input.datum,
        bemerkung: input.bemerkung ?? null,
      });
      return { ok: true };
    }),

  // Bewegungshistorie je Produkt (neueste zuerst)
  bewegungen: authedQuery
    .input(z.object({ productId: z.number() }))
    .query(async ({ input }) => {
      return getDb()
        .select()
        .from(lagerBewegungen)
        .where(eq(lagerBewegungen.productId, input.productId))
        .orderBy(desc(lagerBewegungen.datum), desc(lagerBewegungen.id))
        .limit(60);
    }),

  // Produkt per Barcode/Code/Name suchen (fuer den Scanner)
  scanSuche: authedQuery
    .input(z.object({ code: z.string().min(1) }))
    .query(async ({ input }) => {
      const db = getDb();
      const code = input.code.trim();
      const treffer = await db.select().from(products);
      const direkt = treffer.filter(
        (p) =>
          p.barcode === code ||
          p.artikelnummer?.toLowerCase() === code.toLowerCase() ||
          p.name.toLowerCase() === code.toLowerCase(),
      );
      if (direkt.length > 0) return { treffer: direkt.slice(0, 5), exakt: true };
      const teil = treffer.filter((p) =>
        p.name.toLowerCase().includes(code.toLowerCase()),
      );
      return { treffer: teil.slice(0, 5), exakt: false };
    }),

  // ── Dubletten- & Preisvergleich ──────────────────────────────────────────
  // Gruppiert nach normalisiertem Namen bzw. Artikelnummer; meldet Gruppen
  // mit mehr als einem Eintrag inkl. Preisspanne und guenstigstem Angebot.
  vergleich: authedQuery.query(async () => {
    const db = getDb();
    const alle = await db.select().from(products).where(eq(products.aktiv, true));
    const kondis = await db
      .select({
        productId: konditionen.productId,
        partnerId: konditionen.partnerId,
        preis: konditionen.preisNetto,
        lieferant: suppliers.name,
      })
      .from(konditionen)
      .innerJoin(suppliers, eq(konditionen.partnerId, suppliers.id))
      .where(eq(konditionen.typ, "lieferant"));

    const kondiMap = new Map<number, { preis: string; lieferant: string }[]>();
    for (const k of kondis) {
      if (!kondiMap.has(k.productId)) kondiMap.set(k.productId, []);
      kondiMap.get(k.productId)!.push({ preis: k.preis, lieferant: k.lieferant });
    }

    // Gruppieren: primaer Artikelnummer (wenn vorhanden), sonst Normalname
    const gruppen = new Map<string, typeof alle>();
    for (const p of alle) {
      const schluessel = p.artikelnummer
        ? `nr:${p.artikelnummer.toLowerCase()}`
        : `nm:${normalisiereName(p.name)}`;
      if (!gruppen.has(schluessel)) gruppen.set(schluessel, []);
      gruppen.get(schluessel)!.push(p);
    }

    const ergebnis = [];
    for (const [schluessel, mitglieder] of gruppen) {
      if (mitglieder.length < 2) continue;
      const eintraege = mitglieder.map((p) => {
        const preise: { preis: number; quelle: string }[] = [];
        if (p.ekPreisNetto) preise.push({ preis: Number(p.ekPreisNetto), quelle: "Standard-EK" });
        for (const k of kondiMap.get(p.id) ?? []) {
          preise.push({ preis: Number(k.preis), quelle: k.lieferant });
        }
        const minPreis = preise.length > 0 ? Math.min(...preise.map((x) => x.preis)) : null;
        return {
          id: p.id,
          name: p.name,
          artikelnummer: p.artikelnummer,
          kategorie: p.kategorie,
          ekPreisNetto: p.ekPreisNetto,
          preisNetto: p.preisNetto,
          lieferanten: kondiMap.get(p.id) ?? [],
          guenstigster: minPreis !== null && preise.some((x) => x.preis === minPreis),
          minPreis,
        };
      });
      const allePreise = eintraege.flatMap((e) =>
        [e.ekPreisNetto ? Number(e.ekPreisNetto) : null, ...e.lieferanten.map((l) => Number(l.preis))].filter(
          (x): x is number => x !== null,
        ),
      );
      const min = allePreise.length > 0 ? Math.min(...allePreise) : null;
      const max = allePreise.length > 0 ? Math.max(...allePreise) : null;
      ergebnis.push({
        schluessel,
        eintraege: eintraege.sort((a, b) => (a.minPreis ?? 1e9) - (b.minPreis ?? 1e9)),
        minPreis: min,
        maxPreis: max,
        spanne: min !== null && max !== null && min > 0 ? Math.round(((max - min) / min) * 100) : 0,
      });
    }
    return ergebnis.sort((a, b) => b.spanne - a.spanne);
  }),
});
