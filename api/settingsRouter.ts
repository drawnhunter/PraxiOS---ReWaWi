import { z } from "zod";
import { adminQuery, authedQuery, createRouter } from "./middleware";
import { getDb } from "./queries/connection";
import { companySettings, numberSequences } from "@db/schema";
import { eq, and } from "drizzle-orm";
import { verschluesseln } from "./lib/secrets";
import { randomBytes } from "crypto";

const settingsInput = z.object({
  name: z.string().min(1),
  strasse: z.string().min(1),
  plz: z.string().min(1),
  ort: z.string().min(1),
  land: z.string().default("Deutschland"),
  handelsregister: z.string().nullable().optional(),
  steuernummer: z.string().nullable().optional(),
  ustIdNr: z.string().nullable().optional(),
  waehrung: z.string().min(1).max(10).optional(),
  email: z.string().nullable().optional(),
  telefon: z.string().nullable().optional(),
  webseite: z.string().nullable().optional(),
  standardZahlungsziel: z.number().int().min(0).max(120),
  fussText: z.string().nullable().optional(),
  datevBeraternummer: z.string().nullable().optional(),
  datevMandantennummer: z.string().nullable().optional(),
  steuerberaterEmail: z.string().nullable().optional(),
  typoKorrektur: z.boolean().optional(),
  undoSendeSekunden: z.number().int().min(0).max(60).optional(),
  datevKontenrahmen: z.enum(["SKR03", "SKR04"]).default("SKR03"),
  erloeskonto19: z.string().default("8400"),
  erloeskonto7: z.string().default("8300"),
  erloeskonto0: z.string().default("8120"),
  debitorStartnummer: z.number().int().min(1).default(10000),
  kreditorStartnummer: z.number().int().min(1).default(70000),
  aufwandskontoDefault: z.string().max(10).nullable().optional(),
  // Company Control (v1.6)
  eori: z.string().max(30).nullable().optional(),
  betriebsnummer: z.string().max(30).nullable().optional(),
  bgMitgliedsnummer: z.string().max(50).nullable().optional(),
  ihk: z.string().max(60).nullable().optional(),
  glaeubigerId: z.string().max(30).nullable().optional(),
  akzentfarbe: z
    .enum(["neutral", "blau", "gruen", "bernstein", "violett", "rot"])
    .default("neutral"),
  pdfLayout: z.enum(["klassisch", "modern", "kompakt"]).default("klassisch"),
  smtpHost: z.string().nullable().optional(),
  smtpPort: z.number().int().min(1).max(65535).default(587),
  smtpUser: z.string().nullable().optional(),
  smtpAbsender: z.string().nullable().optional(),
  signatur: z.string().max(2000).nullable().optional(),
  // Klartext nur beim Setzen; leer lassen = bestehendes Passwort behalten
  smtpPasswort: z.string().max(200).optional(),
});

export const settingsRouter = createRouter({
  get: authedQuery.query(async () => {
    const row = await getDb().query.companySettings.findFirst({
      where: eq(companySettings.id, 1),
    });
    if (!row) return null;
    // Passwort niemals ausliefern — nur den Status
    const { smtpPasswortEnc, ...rest } = row;
    return { ...rest, smtpPasswortGesetzt: !!smtpPasswortEnc };
  }),

  update: authedQuery.input(settingsInput).mutation(async ({ input }) => {
    const { smtpPasswort, ...rest } = input;
    const werte: Record<string, unknown> = { id: 1, ...rest };
    if (smtpPasswort) {
      werte.smtpPasswortEnc = verschluesseln(smtpPasswort);
    }
    await getDb()
      .insert(companySettings)
      .values(werte as never)
      .onDuplicateKeyUpdate({ set: werte as never });
    return { ok: true };
  }),

  // ── Agent-API (Kimi Claw) ──
  agentStatus: authedQuery.query(async () => {
    const { agentTokens, agentLog, companySettings } = await import("@db/schema");
    const { desc, eq } = await import("drizzle-orm");
    const db = getDb();
    const [tokens, log, einstellungen] = await Promise.all([
      db.query.agentTokens.findMany({ orderBy: [desc(agentTokens.createdAt)] }),
      db.query.agentLog.findMany({ orderBy: [desc(agentLog.createdAt)], limit: 20 }),
      db.query.companySettings.findFirst({ where: eq(companySettings.id, 1) }),
    ]);
    return {
      autonomie: einstellungen?.agentAutonomie ?? "vorschlag",
      pseudonym: einstellungen?.agentPseudonym !== false,
      tokens: tokens.map((t) => ({ id: t.id, name: t.name, aktiv: t.aktiv, letzteNutzung: t.letzteNutzung, createdAt: t.createdAt })),
      letzteAktionen: log,
    };
  }),

  agentTokenErstellen: adminQuery
    .input(z.object({ name: z.string().trim().min(2).max(100) }))
    .mutation(async ({ input }) => {
      const { agentTokens } = await import("@db/schema");
      const { erzeugeAgentToken, hashToken } = await import("./agentRouter");
      const klar = erzeugeAgentToken();
      const [{ id }] = await getDb()
        .insert(agentTokens)
        .values({ name: input.name, tokenHash: hashToken(klar) })
        .$returningId();
      // Klartext-Token wird NUR jetzt einmalig ausgeliefert
      return { id, name: input.name, token: klar };
    }),

  agentTokenUmschalten: adminQuery
    .input(z.object({ id: z.number(), aktiv: z.boolean() }))
    .mutation(async ({ input }) => {
      const { agentTokens } = await import("@db/schema");
      const { eq } = await import("drizzle-orm");
      await getDb().update(agentTokens).set({ aktiv: input.aktiv }).where(eq(agentTokens.id, input.id));
      return { ok: true };
    }),

  agentPseudonymSetzen: adminQuery
    .input(z.object({ aktiv: z.boolean() }))
    .mutation(async ({ input }) => {
      await getDb()
        .insert(companySettings)
        .values({ id: 1, agentPseudonym: input.aktiv } as never)
        .onDuplicateKeyUpdate({ set: { agentPseudonym: input.aktiv } as never });
      const { pseudonymCacheLeeren } = await import("./lib/pseudonym");
      pseudonymCacheLeeren();
      return { ok: true };
    }),

  agentAutonomieSetzen: adminQuery
    .input(z.object({ stufe: z.enum(["vorschlag", "vollautomatik"]) }))
    .mutation(async ({ input }) => {
      await getDb()
        .insert(companySettings)
        .values({ id: 1, agentAutonomie: input.stufe } as never)
        .onDuplicateKeyUpdate({ set: { agentAutonomie: input.stufe } as never });
      return { ok: true };
    }),

  // ── Modul-Konfiguration ──
  moduleUebersicht: authedQuery.query(async () => {
    const { MODUL_DEFS, ladeModulKonfig } = await import("./lib/module");
    const konfig = await ladeModulKonfig();
    return MODUL_DEFS.map((d) => ({ ...d, aktiv: konfig[d.id] !== false }));
  }),

  modulSetzen: adminQuery
    .input(z.object({ modul: z.string().min(2).max(40), aktiv: z.boolean() }))
    .mutation(async ({ input }) => {
      const { MODUL_DEFS, ladeModulKonfig, modulCacheLeeren } = await import("./lib/module");
      if (!MODUL_DEFS.some((d) => d.id === input.modul)) throw new Error("Unbekanntes Modul.");
      const konfig = await ladeModulKonfig();
      const neu = { ...konfig, [input.modul]: input.aktiv };
      await getDb()
        .insert(companySettings)
        .values({ id: 1, modulKonfig: JSON.stringify(neu) } as never)
        .onDuplicateKeyUpdate({ set: { modulKonfig: JSON.stringify(neu) } as never });
      modulCacheLeeren();
      return { ok: true };
    }),

  sequences: authedQuery.query(async () => {
    return getDb().select().from(numberSequences);
  }),

  /** ICS-Abo-Token fuer den Zahlungsziele-Kalender (wird bei Bedarf erzeugt). */
  icsStatus: authedQuery.query(async () => {
    const db = getDb();
    const row = await db.query.companySettings.findFirst({ where: eq(companySettings.id, 1) });
    if (row?.icsToken) return { token: row.icsToken };
    const token = randomBytes(24).toString("hex");
    await db.update(companySettings).set({ icsToken: token }).where(eq(companySettings.id, 1));
    return { token };
  }),

  icsNeu: adminQuery.mutation(async () => {
    const token = randomBytes(24).toString("hex");
    await getDb().update(companySettings).set({ icsToken: token }).where(eq(companySettings.id, 1));
    return { token };
  }),

  /** Startwert des Nummernkreises korrigieren — nur aufwärts erlaubt (GoBD). */
  setSequenceStart: authedQuery
    .input(
      z.object({
        typ: z.enum(["invoice", "credit_note", "delivery_note", "purchase_order", "offer"]),
        jahr: z.number().int(),
        naechsteNummer: z.number().int().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const [row] = await db
        .select()
        .from(numberSequences)
        .where(
          and(
            eq(numberSequences.typ, input.typ),
            eq(numberSequences.jahr, input.jahr),
          ),
        );
      const gewuenschterStand = input.naechsteNummer - 1;
      if (row && gewuenschterStand < row.letzteNummer) {
        throw new Error(
          `Nummernkreis kann nicht zurückgesetzt werden (aktueller Stand: ${row.letzteNummer}).`,
        );
      }
      if (row) {
        await db
          .update(numberSequences)
          .set({ letzteNummer: gewuenschterStand })
          .where(eq(numberSequences.id, row.id));
      } else {
        await db
          .insert(numberSequences)
          .values({ typ: input.typ, jahr: input.jahr, letzteNummer: gewuenschterStand });
      }
      return { ok: true };
    }),
});
