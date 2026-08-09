// ── Kontierung: Kontenrahmen (SKR03/04) + Kategorien (Schnellauswahl) ───────
import { z } from "zod";
import { and, asc, eq, like, or, sql } from "drizzle-orm";
import { adminQuery, authedQuery, createRouter } from "./middleware";
import { getDb } from "./queries/connection";
import { companySettings, kategorien, kontenrahmen } from "@db/schema";
import { SKR03, SKR04 } from "./skr-data";

// Kategorien-Startset je Rahmen (verifiziert gegen die Basisdaten)
const KATEGORIE_SEED: Record<string, [string, string][]> = {
  SKR03: [
    ["Strom & Energie", "4240"],
    ["Miete", "4210"],
    ["Telefon", "4920"],
    ["Internet", "4925"],
    ["Bürobedarf", "4930"],
    ["Porto & Versand", "4910"],
    ["Versicherungen", "4360"],
    ["Reisekosten", "4673"],
    ["Werbung", "4600"],
    ["Material & Waren", "3000"],
    ["Sonstige Aufwendungen", "4900"],
  ],
  SKR04: [
    ["Strom & Energie", "6330"],
    ["Miete", "6310"],
    ["Telefon", "6805"],
    ["Internet", "6815"],
    ["Bürobedarf", "6820"],
    ["Porto & Versand", "6800"],
    ["Versicherungen", "6400"],
    ["Reisekosten", "6673"],
    ["Werbung", "6600"],
    ["Material & Waren", "5000"],
    ["Sonstige Aufwendungen", "6305"],
  ],
};

/** Einmalig beim Start: Kontenrahmen + Kategorien vorbefuellen (idempotent). */
export async function seedKontierung(): Promise<void> {
  const db = getDb();
  const [krRows] = (await db.execute(sql`SELECT COUNT(*) AS n FROM kontenrahmen`)) as unknown as [
    { n: number }[],
    unknown,
  ];
  if (Number(krRows[0]?.n ?? 0) === 0) {
    for (const [rahmen, daten] of [
      ["SKR03", SKR03],
      ["SKR04", SKR04],
    ] as const) {
      for (const [konto, bezeichnung, klasse, gruppe] of daten) {
        await db.insert(kontenrahmen).values({ rahmen, konto, bezeichnung, klasse, gruppe });
      }
    }
    console.log("[seed] Kontenrahmen SKR03/SKR04 vorbefüllt");
  }

  const [katRows] = (await db.execute(sql`SELECT COUNT(*) AS n FROM kategorien`)) as unknown as [
    { n: number }[],
    unknown,
  ];
  if (Number(katRows[0]?.n ?? 0) === 0) {
    const einst = await db.query.companySettings.findFirst({ where: eq(companySettings.id, 1) });
    const rahmen = einst?.datevKontenrahmen === "SKR04" ? "SKR04" : "SKR03";
    const set = KATEGORIE_SEED[rahmen];
    for (let i = 0; i < set.length; i++) {
      const [name, konto] = set[i];
      await db.insert(kategorien).values({ name, konto, sortierung: i + 1 });
    }
    // Aufwandskonto-Default gleich mitsetzen
    const sonstige = set[set.length - 1][1];
    await db
      .update(companySettings)
      .set({ aufwandskontoDefault: sonstige })
      .where(eq(companySettings.id, 1));
    console.log(`[seed] Kategorien (${rahmen}) vorbefüllt`);
  }
}

export const kontierungRouter = createRouter({
  konten: authedQuery
    .input(z.object({ suche: z.string().max(100).optional(), rahmen: z.enum(["SKR03", "SKR04"]).optional() }))
    .query(async ({ input }) => {
      const db = getDb();
      const einst = await db.query.companySettings.findFirst({ where: eq(companySettings.id, 1) });
      const rahmen = input.rahmen ?? (einst?.datevKontenrahmen === "SKR04" ? "SKR04" : "SKR03");
      const bedingungen = [eq(kontenrahmen.rahmen, rahmen)];
      if (input.suche?.trim()) {
        const q = `%${input.suche.trim()}%`;
        bedingungen.push(or(like(kontenrahmen.konto, q), like(kontenrahmen.bezeichnung, q))!);
      }
      return db
        .select()
        .from(kontenrahmen)
        .where(and(...bedingungen))
        .orderBy(asc(kontenrahmen.konto))
        .limit(80);
    }),

  kategorien: authedQuery.query(async () => {
    return getDb().select().from(kategorien).orderBy(asc(kategorien.sortierung), asc(kategorien.name));
  }),

  kategorieAnlegen: adminQuery
    .input(
      z.object({
        name: z.string().min(1).max(100),
        konto: z.string().max(10).nullish(),
        ustSatz: z.number().int().min(0).max(100).default(19),
      }),
    )
    .mutation(async ({ input }) => {
      const [r] = await getDb()
        .insert(kategorien)
        .values({ name: input.name, konto: input.konto ?? null, ustSatz: input.ustSatz })
        .$returningId();
      return { id: r.id };
    }),

  kategorieAktualisieren: adminQuery
    .input(
      z.object({
        id: z.number().int(),
        name: z.string().min(1).max(100),
        konto: z.string().max(10).nullish(),
        ustSatz: z.number().int().min(0).max(100),
      }),
    )
    .mutation(async ({ input }) => {
      await getDb()
        .update(kategorien)
        .set({ name: input.name, konto: input.konto ?? null, ustSatz: input.ustSatz })
        .where(eq(kategorien.id, input.id));
      return { ok: true };
    }),

  kategorieLoeschen: adminQuery.input(z.object({ id: z.number().int() })).mutation(async ({ input }) => {
    await getDb().delete(kategorien).where(eq(kategorien.id, input.id));
    return { ok: true };
  }),
});
