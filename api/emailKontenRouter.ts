// ── E-Mail-Eingang: Verwaltung der IMAP-Postfaecher (mehrere, mit Route) ────
import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { adminQuery, authedQuery, createRouter } from "./middleware";
import { getDb } from "./queries/connection";
import { emailKonten } from "@db/schema";
import { verschluesseln } from "./lib/secrets";
import { testeKonto } from "./imapDienst";

const kontoInput = z.object({
  name: z.string().min(1).max(100),
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535).default(993),
  tls: z.boolean().default(true),
  benutzer: z.string().min(1).max(255),
  passwort: z.string().max(200).optional(), // leer = bestehendes behalten
  ordner: z.string().max(100).default("INBOX"),
  route: z.enum(["rechnung", "sonstiges"]).default("rechnung"),
  intervallMinuten: z.number().int().min(1).max(1440).default(10),
  aktiv: z.boolean().default(true),
  // Kontobezogener Versand (optional — ohne diese Daten geht Versand ueber Firmen-SMTP)
  smtpHost: z.string().max(255).nullable().optional(),
  smtpPort: z.number().int().min(1).max(65535).nullable().optional(),
  smtpBenutzer: z.string().max(255).nullable().optional(),
  smtpPasswort: z.string().max(200).optional(), // leer = bestehendes behalten
  smtpAbsender: z.string().max(255).nullable().optional(),
});

export const emailKontenRouter = createRouter({
  liste: authedQuery.query(async () => {
    const db = getDb();
    const zeilen = await db.select().from(emailKonten).orderBy(asc(emailKonten.name));
    return zeilen.map(({ passwortEnc, smtpPasswortEnc, ...rest }) => ({
      ...rest,
      passwortGesetzt: !!passwortEnc,
      smtpPasswortGesetzt: !!smtpPasswortEnc,
    }));
  }),

  anlegen: adminQuery.input(kontoInput).mutation(async ({ input }) => {
    const { passwort, smtpPasswort, ...rest } = input;
    if (!passwort) throw new Error("Passwort fehlt.");
    const [r] = await getDb()
      .insert(emailKonten)
      .values({
        ...rest,
        passwortEnc: verschluesseln(passwort),
        ...(smtpPasswort ? { smtpPasswortEnc: verschluesseln(smtpPasswort) } : {}),
      })
      .$returningId();
    return { id: r.id };
  }),

  aktualisieren: adminQuery
    .input(kontoInput.extend({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      const { id, passwort, smtpPasswort, ...rest } = input;
      const werte: Record<string, unknown> = { ...rest };
      if (passwort) werte.passwortEnc = verschluesseln(passwort);
      if (smtpPasswort) werte.smtpPasswortEnc = verschluesseln(smtpPasswort);
      await getDb().update(emailKonten).set(werte).where(eq(emailKonten.id, id));
      return { ok: true };
    }),

  loeschen: adminQuery.input(z.object({ id: z.number().int() })).mutation(async ({ input }) => {
    await getDb().delete(emailKonten).where(eq(emailKonten.id, input.id));
    return { ok: true };
  }),

  testen: adminQuery.input(z.object({ id: z.number().int() })).mutation(async ({ input }) => {
    return testeKonto(input.id);
  }),
});
