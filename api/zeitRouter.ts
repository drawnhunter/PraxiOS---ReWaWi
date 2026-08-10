// ── Zeiterfassung (v1.7): Stempeln, Eintraege, Auswertung, Abrechnung ──────
import { z } from "zod";
import { authedQuery, createRouter } from "./middleware";
import { getDb } from "./queries/connection";
import { customers, invoices, invoiceItems, mitarbeiter, products, zeiteintraege } from "@db/schema";
import { and, asc, desc, eq, gte, isNull, lt, lte, sql } from "drizzle-orm";

const datumZeit = z.string().regex(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}$/, "Format: JJJJ-MM-TT HH:MM");

function zuDate(s: string): Date {
  return new Date(s.replace(" ", "T") + ":00");
}
function stunden(von: Date, bis: Date | null): number {
  const ende = bis ?? new Date();
  return Math.max(0, (ende.getTime() - von.getTime()) / 3600000);
}

const mitarbeiterInput = z.object({
  name: z.string().min(1).max(120),
  farbe: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#0f766e"),
  stundensatz: z.string().regex(/^\d+(\.\d{1,2})?$/).nullable().optional(),
  aktiv: z.boolean().default(true),
});

export const zeitRouter = createRouter({
  // ── Mitarbeiter ──
  mitarbeiterListe: authedQuery.query(async () => {
    return getDb().select().from(mitarbeiter).orderBy(asc(mitarbeiter.name));
  }),
  mitarbeiterAnlegen: authedQuery.input(mitarbeiterInput).mutation(async ({ input }) => {
    const [{ id }] = await getDb()
      .insert(mitarbeiter)
      .values({ ...input, stundensatz: input.stundensatz ?? null })
      .$returningId();
    return { id };
  }),
  mitarbeiterAktualisieren: authedQuery
    .input(z.object({ id: z.number(), data: mitarbeiterInput }))
    .mutation(async ({ input }) => {
      await getDb()
        .update(mitarbeiter)
        .set({ ...input.data, stundensatz: input.data.stundensatz ?? null })
        .where(eq(mitarbeiter.id, input.id));
      return { ok: true };
    }),

  // ── Stempeln ──
  laufend: authedQuery.query(async () => {
    const db = getDb();
    const rows = await db
      .select({ z: zeiteintraege, mitarbeiterName: mitarbeiter.name, kundeName: customers.name, farbe: mitarbeiter.farbe })
      .from(zeiteintraege)
      .leftJoin(mitarbeiter, eq(zeiteintraege.mitarbeiterId, mitarbeiter.id))
      .leftJoin(customers, eq(zeiteintraege.customerId, customers.id))
      .where(isNull(zeiteintraege.bis))
      .orderBy(asc(zeiteintraege.von));
    return rows.map((r) => ({ ...r, stundenLaufend: stunden(r.z.von, null).toFixed(2) }));
  }),

  stempelStart: authedQuery
    .input(
      z.object({
        mitarbeiterId: z.number(),
        customerId: z.number().nullable().optional(),
        notiz: z.string().max(255).nullable().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const laufend = await db.query.zeiteintraege.findFirst({
        where: and(eq(zeiteintraege.mitarbeiterId, input.mitarbeiterId), isNull(zeiteintraege.bis)),
      });
      if (laufend) {
        const m = await db.query.mitarbeiter.findFirst({ where: eq(mitarbeiter.id, input.mitarbeiterId) });
        throw new Error(`${m?.name ?? "Mitarbeiter"} stempelt bereits — erst stoppen.`);
      }
      const [{ id }] = await db
        .insert(zeiteintraege)
        .values({
          mitarbeiterId: input.mitarbeiterId,
          customerId: input.customerId ?? null,
          von: new Date(),
          notiz: input.notiz ?? null,
          quelle: "stempel",
        })
        .$returningId();
      return { id };
    }),

  stempelStop: authedQuery
    .input(z.object({ mitarbeiterId: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const laufend = await db.query.zeiteintraege.findFirst({
        where: and(eq(zeiteintraege.mitarbeiterId, input.mitarbeiterId), isNull(zeiteintraege.bis)),
      });
      if (!laufend) throw new Error("Kein laufender Stempel für diesen Mitarbeiter.");
      await db.update(zeiteintraege).set({ bis: new Date() }).where(eq(zeiteintraege.id, laufend.id));
      return { id: laufend.id, stunden: stunden(laufend.von, new Date()).toFixed(2) };
    }),

  // ── Eintraege ──
  eintraege: authedQuery
    .input(
      z.object({
        mitarbeiterId: z.number().nullish(),
        customerId: z.number().nullish(),
        von: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
        bis: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
        nurOffen: z.boolean().default(false), // nur nicht gesperrte & nicht abgerechnete
        q: z.string().nullish(),
      }).optional(),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const bed = [];
      if (input?.mitarbeiterId) bed.push(eq(zeiteintraege.mitarbeiterId, input.mitarbeiterId));
      if (input?.customerId) bed.push(eq(zeiteintraege.customerId, input.customerId));
      if (input?.von) bed.push(gte(zeiteintraege.von, new Date(input.von + "T00:00:00")));
      if (input?.bis) bed.push(lt(zeiteintraege.von, new Date(input.bis + "T23:59:59")));
      if (input?.nurOffen) bed.push(eq(zeiteintraege.gesperrt, false), isNull(zeiteintraege.invoiceId));
      if (input?.q?.trim()) bed.push(lte(zeiteintraege.notiz, `%${input.q.trim()}%`));
      const rows = await db
        .select({ z: zeiteintraege, mitarbeiterName: mitarbeiter.name, farbe: mitarbeiter.farbe, kundeName: customers.name })
        .from(zeiteintraege)
        .leftJoin(mitarbeiter, eq(zeiteintraege.mitarbeiterId, mitarbeiter.id))
        .leftJoin(customers, eq(zeiteintraege.customerId, customers.id))
        .where(bed.length ? and(...bed) : undefined)
        .orderBy(desc(zeiteintraege.von), desc(zeiteintraege.id))
        .limit(1000);
      return rows.map((r) => ({ ...r, stunden: stunden(r.z.von, r.z.bis).toFixed(2) }));
    }),

  eintragManuell: authedQuery
    .input(
      z.object({
        mitarbeiterId: z.number(),
        customerId: z.number().nullable().optional(),
        von: datumZeit,
        bis: datumZeit,
        notiz: z.string().max(255).nullable().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const von = zuDate(input.von);
      const bis = zuDate(input.bis);
      if (bis <= von) throw new Error("Ende muss nach dem Start liegen.");
      const [{ id }] = await getDb()
        .insert(zeiteintraege)
        .values({
          mitarbeiterId: input.mitarbeiterId,
          customerId: input.customerId ?? null,
          von,
          bis,
          notiz: input.notiz ?? null,
          quelle: "manuell",
        })
        .$returningId();
      return { id };
    }),

  eintragAktualisieren: authedQuery
    .input(
      z.object({
        id: z.number(),
        data: z.object({
          customerId: z.number().nullable().optional(),
          von: datumZeit.optional(),
          bis: datumZeit.nullish(),
          notiz: z.string().max(255).nullable().optional(),
        }),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const e = await db.query.zeiteintraege.findFirst({ where: eq(zeiteintraege.id, input.id) });
      if (!e) throw new Error("Eintrag nicht gefunden.");
      if (e.gesperrt || e.invoiceId) throw new Error("Gesperrte/abgerechnete Einträge sind unveränderbar (GoBD).");
      const werte: Record<string, unknown> = {};
      if (input.data.customerId !== undefined) werte.customerId = input.data.customerId;
      if (input.data.von) werte.von = zuDate(input.data.von);
      if (input.data.bis !== undefined) werte.bis = input.data.bis ? zuDate(input.data.bis) : null;
      if (input.data.notiz !== undefined) werte.notiz = input.data.notiz;
      await db.update(zeiteintraege).set(werte).where(eq(zeiteintraege.id, input.id));
      return { ok: true };
    }),

  eintragLoeschen: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const e = await db.query.zeiteintraege.findFirst({ where: eq(zeiteintraege.id, input.id) });
      if (!e) throw new Error("Eintrag nicht gefunden.");
      if (e.gesperrt || e.invoiceId) throw new Error("Gesperrte/abgerechnete Einträge sind unveränderbar (GoBD).");
      await db.delete(zeiteintraege).where(eq(zeiteintraege.id, input.id));
      return { ok: true };
    }),

  /** GoBD-Freigabe: Eintraege unveränderbar machen. */
  freigeben: authedQuery
    .input(z.object({ ids: z.array(z.number()).min(1) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      let n = 0;
      for (const id of input.ids) {
        await db
          .update(zeiteintraege)
          .set({ gesperrt: true })
          .where(and(eq(zeiteintraege.id, id), eq(zeiteintraege.gesperrt, false), isNull(zeiteintraege.invoiceId), sql`${zeiteintraege.bis} IS NOT NULL`));
        n++;
      }
      return { freigegeben: n };
    }),

  /** Killer-Feature: Offene Einträge eines Kunden als Rechnungspositionen. */
  zuRechnung: authedQuery
    .input(
      z.object({
        customerId: z.number(),
        ids: z.array(z.number()).min(1),
        produktId: z.number().nullable().optional(), // Stundensatz-Produkt; sonst Mitarbeiter-Stundensatz
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const kunde = await db.query.customers.findFirst({ where: eq(customers.id, input.customerId) });
      if (!kunde) throw new Error("Kunde nicht gefunden.");
      const produkt = input.produktId
        ? await db.query.products.findFirst({ where: eq(products.id, input.produktId) })
        : null;

      const ausgewaehlt: { z: typeof zeiteintraege.$inferSelect; name: string | null; satz: string | null }[] = [];
      for (const id of input.ids) {
        const e = await db.query.zeiteintraege.findFirst({
          where: and(
            eq(zeiteintraege.id, id),
            eq(zeiteintraege.customerId, input.customerId),
            eq(zeiteintraege.gesperrt, false),
            isNull(zeiteintraege.invoiceId),
            sql`${zeiteintraege.bis} IS NOT NULL`,
          ),
        });
        if (!e) throw new Error(`Eintrag #${id} ist nicht abrechenbar (gesperrt, abgerechnet oder noch laufend).`);
        const m = await db.query.mitarbeiter.findFirst({ where: eq(mitarbeiter.id, e.mitarbeiterId) });
        ausgewaehlt.push({ z: e, name: m?.name ?? null, satz: m?.stundensatz ?? null });
      }

      // Rechnungsentwurf anlegen (Kunden-Snapshot wie createDraft)
      const heute = new Date();
      const faellig = new Date(heute);
      faellig.setDate(faellig.getDate() + (kunde.zahlungszielTage ?? 14));
      const fmt = (d: Date) => d.toISOString().slice(0, 10);
      const [{ id: rechnungId }] = await db
        .insert(invoices)
        .values({
          customerId: kunde.id,
          rechnungsdatum: fmt(heute),
          faelligkeitsdatum: fmt(faellig),
          kundeName: kunde.name,
          kundeZusatz: kunde.zusatz,
          kundeStrasse: kunde.strasse,
          kundePlz: kunde.plz,
          kundeOrt: kunde.ort,
          kundeLand: kunde.land,
          bemerkung: "Aus Zeiterfassung erzeugt",
        })
        .$returningId();

      const positionen = ausgewaehlt.map((a, i) => {
        const h = stunden(a.z.von, a.z.bis);
        const preis = produkt?.preisNetto ?? a.satz;
        if (!preis) throw new Error(`Kein Stundensatz für ${a.name ?? "Mitarbeiter"} — Produkt wählen oder Satz pflegen.`);
        const datum = a.z.von.toISOString().slice(0, 10).split("-").reverse().join(".");
        return {
          invoiceId: rechnungId,
          position: i + 1,
          bezeichnung: `${a.z.notiz?.trim() || "Arbeitszeit"}${a.name ? ` (${a.name})` : ""}`,
          beschreibung: `Zeiterfassung ${datum}${a.z.notiz ? "" : ""}`,
          menge: h.toFixed(2),
          einheit: "Std.",
          einzelpreis: Number(preis).toFixed(2),
          ustSatz: 19,
        };
      });
      await db.insert(invoiceItems).values(positionen);

      // Summen der Rechnung aktualisieren + Eintraege verknuepfen
      const netto = positionen.reduce((a, p) => a + Number(p.menge) * Number(p.einzelpreis), 0);
      const ust = Math.round(netto * 0.19 * 100) / 100;
      await db
        .update(invoices)
        .set({ netto: netto.toFixed(2), ust: ust.toFixed(2), brutto: (netto + ust).toFixed(2) })
        .where(eq(invoices.id, rechnungId));
      for (const a of ausgewaehlt) {
        await db.update(zeiteintraege).set({ invoiceId: rechnungId }).where(eq(zeiteintraege.id, a.z.id));
      }
      return { rechnungId, positionen: positionen.length };
    }),

  /** Auswertung: Stunden pro Mitarbeiter x Kunde fuer Jahr/Monat. */
  auswertung: authedQuery
    .input(z.object({ jahr: z.number().int(), monat: z.number().int().min(1).max(12) }))
    .query(async ({ input }) => {
      const db = getDb();
      const start = new Date(`${input.jahr}-${String(input.monat).padStart(2, "0")}-01T00:00:00`);
      const ende = new Date(input.jahr, input.monat, 1);
      const rows = await db
        .select({ z: zeiteintraege, mitarbeiterName: mitarbeiter.name, kundeName: customers.name })
        .from(zeiteintraege)
        .leftJoin(mitarbeiter, eq(zeiteintraege.mitarbeiterId, mitarbeiter.id))
        .leftJoin(customers, eq(zeiteintraege.customerId, customers.id))
        .where(and(gte(zeiteintraege.von, start), lt(zeiteintraege.von, ende), sql`${zeiteintraege.bis} IS NOT NULL`));
      const proMitarbeiter = new Map<string, { gesamt: number; kunden: Map<string, number> }>();
      for (const r of rows) {
        const h = stunden(r.z.von, r.z.bis);
        const m = r.mitarbeiterName ?? `#${r.z.mitarbeiterId}`;
        const k = r.kundeName ?? "(ohne Kunde)";
        if (!proMitarbeiter.has(m)) proMitarbeiter.set(m, { gesamt: 0, kunden: new Map() });
        const e = proMitarbeiter.get(m)!;
        e.gesamt += h;
        e.kunden.set(k, (e.kunden.get(k) ?? 0) + h);
      }
      return [...proMitarbeiter.entries()].map(([name, e]) => ({
        name,
        gesamt: e.gesamt.toFixed(2),
        kunden: [...e.kunden.entries()].map(([kunde, h]) => ({ kunde, stunden: h.toFixed(2) })).sort((a, b) => Number(b.stunden) - Number(a.stunden)),
      }));
    }),
});
