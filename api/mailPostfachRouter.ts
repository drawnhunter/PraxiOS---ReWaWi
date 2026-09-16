// ── Mail-Postfach: Ordner, Liste, Detail, Anhang, Sync ─────────────────────
// Liest aus mail_mails (DB, schnell + durchsuchbar). Anhaenge liegen (wenn
// PDF/JPG/PNG) im Post Manager; darauf verweist die Meta.
import { z } from "zod";
import { authedQuery, createRouter } from "./middleware";
import { getDb } from "./queries/connection";
import { mailMails, emailKonten, postEingang } from "@db/schema";
import { and, asc, desc, eq, like, or, sql } from "drizzle-orm";

/** Sichtbare Konto-IDs des Benutzers (users.mailKontoIds JSON; null = alle). */
async function sichtbareKontoIds(user: { id?: number } | undefined): Promise<number[] | null> {
  if (!user?.id) return null; // aeltere Sessions/Kontexte: alles sichtbar
  const { users } = await import("@db/schema");
  const u = await getDb().query.users.findFirst({ where: eq(users.id, user.id) });
  if (!u?.mailKontoIds) return null; // alle sichtbar
  try {
    return JSON.parse(u.mailKontoIds) as number[];
  } catch {
    return null;
  }
}

/** Wirft FORBIDDEN wenn das Konto fuer den Benutzer nicht sichtbar ist. */
async function pruefeSichtbarkeit(user: { id?: number } | undefined, kontoId: number): Promise<void> {
  const ids = await sichtbareKontoIds(user);
  if (ids && !ids.includes(kontoId)) {
    throw new Error("Dieses Postfach ist für deinen Benutzer nicht freigegeben.");
  }
}

function metaLesen(anhaenge: string | null): { name: string; mime: string; groesse: number; postEingangId: number | null }[] {
  if (!anhaenge) return [];
  try {
    return JSON.parse(anhaenge) as { name: string; mime: string; groesse: number; postEingangId: number | null }[];
  } catch {
    return [];
  }
}

export const mailPostfachRouter = createRouter({
  /** Konten + Ordner + Zaehler (ungelesen je Ordner). */
  postfaecher: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const sichtbar = await sichtbareKontoIds(ctx.user);
    let konten = await db.select().from(emailKonten).orderBy(asc(emailKonten.name));
    if (sichtbar) konten = konten.filter((k) => sichtbar.includes(k.id));
    const aus = [];
    for (const k of konten) {
      const ordner = await db
        .select({
          ordner: mailMails.ordner,
          anzahl: sql<string>`COUNT(*)`,
          ungelesen: sql<string>`SUM(CASE WHEN ${mailMails.gelesen} = 0 THEN 1 ELSE 0 END)`,
        })
        .from(mailMails)
        .where(eq(mailMails.kontoId, k.id))
        .groupBy(mailMails.ordner);
      // Entdeckte Fächer (ordnerListe) mit einblenden — auch ohne Mails darin
      const stats = new Map(ordner.map((o) => [o.ordner, { anzahl: Number(o.anzahl), ungelesen: Number(o.ungelesen) }]));
      let entdeckt: string[] = [];
      try {
        entdeckt = k.ordnerListe ? (JSON.parse(k.ordnerListe) as string[]) : [];
      } catch { /* keine Liste */ }
      const ordnerNamen = [...new Set([...entdeckt, ...stats.keys()])];
      aus.push({
        id: k.id,
        name: k.name,
        benutzer: k.benutzer,
        aktiv: k.aktiv,
        letzterAbruf: k.letzterAbruf,
        letzterFehler: k.letzterFehler,
        ordner: ordnerNamen.map((name) => ({
          name,
          anzahl: stats.get(name)?.anzahl ?? 0,
          ungelesen: stats.get(name)?.ungelesen ?? 0,
        })),
      });
    }
    return aus;
  }),

  /** Mail-Liste mit Suche/Filtern. */
  liste: authedQuery
    .input(
      z.object({
        kontoId: z.number().optional(),
        ordner: z.string().optional(),
        q: z.string().optional(),
        nurUngelesene: z.boolean().optional(),
        richtung: z.enum(["alle", "empfangen", "gesendet", "markiert"]).optional(),
        filter: z.enum(["alle", "ungelesen", "gelesen", "markiert", "gesendet", "empfangen"]).optional(),
        sortBy: z.enum(["datum", "absender", "groesse"]).optional(),
        sortDir: z.enum(["asc", "desc"]).optional(),
        von: z.string().optional(),
        bis: z.string().optional(),
        seite: z.number().int().min(1).default(1),
      }),
    )
    .query(async ({ input, ctx }) => {
      const db = getDb();
      if (input.kontoId) await pruefeSichtbarkeit(ctx.user, input.kontoId);
      const sichtbar = await sichtbareKontoIds(ctx.user);
      const bedingungen = [];
      if (input.kontoId) bedingungen.push(eq(mailMails.kontoId, input.kontoId));
      else if (sichtbar) bedingungen.push(sql`${mailMails.kontoId} IN (${sql.join(sichtbar.map((i) => sql`${i}`), sql`, `)})`);
      if (input.ordner) bedingungen.push(eq(mailMails.ordner, input.ordner));
      if (input.nurUngelesene) bedingungen.push(eq(mailMails.gelesen, false));
      // Einheitlicher Filter (hat Vorrang vor richtung)
      const f = input.filter ?? input.richtung;
      if (f === "ungelesen") bedingungen.push(eq(mailMails.gelesen, false));
      else if (f === "gelesen") bedingungen.push(eq(mailMails.gelesen, true));
      else if (f === "markiert") bedingungen.push(eq(mailMails.markiert, true));
      else if (f === "gesendet") {
        bedingungen.push(or(like(mailMails.ordner, "%sent%"), like(mailMails.ordner, "%gesendet%")));
      } else if (f === "empfangen") {
        bedingungen.push(sql`${mailMails.ordner} NOT LIKE '%sent%' AND ${mailMails.ordner} NOT LIKE '%gesendet%'`);
      }
      if (input.von) bedingungen.push(sql`${mailMails.datum} >= ${input.von}`);
      if (input.bis) bedingungen.push(sql`${mailMails.datum} <= ${input.bis} 23:59:59`);
      if (input.q?.trim()) {
        const q = `%${input.q.trim()}%`;
        bedingungen.push(
          or(
            like(mailMails.betreff, q),
            like(mailMails.absenderName, q),
            like(mailMails.absenderAdresse, q),
            like(mailMails.textPlain, q),
          ),
        );
      }
      const seite = input.seite;
      const PRO_SEITE = 40;
      const rows = await db
        .select()
        .from(mailMails)
        .where(bedingungen.length ? and(...bedingungen) : undefined)
        .orderBy(
          ...(input.sortBy === "absender"
            ? [input.sortDir === "desc" ? desc(mailMails.absenderAdresse) : asc(mailMails.absenderAdresse)]
            : input.sortBy === "groesse"
              ? [input.sortDir === "desc" ? desc(sql`LENGTH(${mailMails.textPlain}) + LENGTH(${mailMails.textHtml})`) : asc(sql`LENGTH(${mailMails.textPlain}) + LENGTH(${mailMails.textHtml})`)]
              : input.sortDir === "asc"
                ? [asc(mailMails.datum), asc(mailMails.id)]
                : [desc(mailMails.datum), desc(mailMails.id)]),
        )
        .limit(PRO_SEITE)
        .offset((seite - 1) * PRO_SEITE);
      const [{ gesamt }] = await db
        .select({ gesamt: sql<string>`COUNT(*)` })
        .from(mailMails)
        .where(bedingungen.length ? and(...bedingungen) : undefined);
      return {
        gesamt: Number(gesamt),
        seite,
        proSeite: PRO_SEITE,
        mails: rows.map((m) => ({
          id: m.id,
          kontoId: m.kontoId,
          ordner: m.ordner,
          betreff: m.betreff,
          absenderName: m.absenderName,
          absenderAdresse: m.absenderAdresse,
          datum: m.datum,
          gelesen: m.gelesen,
          markiert: m.markiert,
          anzahlAnhaenge: metaLesen(m.anhaenge).length,
        })),
      };
    }),

  /** Einzelne Mail (Volltext + Anhang-Metadaten). */
  einzel: authedQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const m = await db.query.mailMails.findFirst({ where: eq(mailMails.id, input.id) });
      if (!m) throw new Error("Mail nicht gefunden.");
      await pruefeSichtbarkeit(ctx.user, m.kontoId);
      // Beim Oeffnen als gelesen markieren (lokal; Server-Flag bleibt unberuehrt)
      if (!m.gelesen) {
        await db.update(mailMails).set({ gelesen: true }).where(eq(mailMails.id, m.id));
      }
      return {
        ...m,
        gelesen: true,
        anhaengeMeta: metaLesen(m.anhaenge),
      };
    }),

  /** Gelesen/Markiert setzen. */
  markieren: authedQuery
    .input(z.object({ id: z.number(), gelesen: z.boolean().optional(), markiert: z.boolean().optional() }))
    .mutation(async ({ input }) => {
      const patch: Record<string, unknown> = {};
      if (input.gelesen !== undefined) patch.gelesen = input.gelesen;
      if (input.markiert !== undefined) patch.markiert = input.markiert;
      await getDb().update(mailMails).set(patch).where(eq(mailMails.id, input.id));
      return { ok: true };
    }),

  /** Anhang herunterladen (aus dem Post Manager). */
  anhang: authedQuery
    .input(z.object({ mailId: z.number(), index: z.number().int().min(0) }))
    .query(async ({ input }) => {
      const db = getDb();
      const m = await db.query.mailMails.findFirst({ where: eq(mailMails.id, input.mailId) });
      if (!m) throw new Error("Mail nicht gefunden.");
      const meta = metaLesen(m.anhaenge)[input.index];
      if (!meta) throw new Error("Anhang nicht gefunden.");
      if (!meta.postEingangId) {
        throw new Error("Dieser Anhangtyp wird nur als Metadaten gefuehrt (kein Download — nur PDF/JPG/PNG landen im Post Manager).");
      }
      const beleg = await db.query.postEingang.findFirst({ where: eq(postEingang.id, meta.postEingangId) });
      if (!beleg?.dateiInhalt) throw new Error("Anhang-Datei nicht mehr vorhanden.");
      return {
        dateiname: beleg.originalname,
        mime: beleg.mime,
        base64: beleg.dateiInhalt,
        postEingangId: meta.postEingangId,
      };
    }),

  /** Manueller Sync eines Kontos. */
  syncJetzt: authedQuery
    .input(z.object({ kontoId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await pruefeSichtbarkeit(ctx.user, input.kontoId);
      const { synchronisiereKonto } = await import("./imapDienst");
      return synchronisiereKonto(input.kontoId);
    }),

  /** Mail verfassen/versenden (mit Signatur). */
  versenden: authedQuery
    .input(
      z.object({
        empfaenger: z.array(z.string().email()).min(1),
        cc: z.array(z.string().email()).optional(),
        bcc: z.array(z.string().email()).optional(),
        betreff: z.string().min(1).max(500),
        text: z.string().min(1),
        html: z.string().optional(),
        anhaenge: z.array(z.object({ dateiname: z.string(), base64: z.string(), mime: z.string() })).optional(),
        inReplyTo: z.string().nullish(),
        references: z.string().nullish(),
        mitSignatur: z.boolean().default(true),
        kontoId: z.number().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (input.kontoId) await pruefeSichtbarkeit(ctx.user, input.kontoId);
      const { versendeMail } = await import("./lib/mailVersand");
      const r = await versendeMail(input);
      if (!r.ok) throw new Error(`Versand fehlgeschlagen: ${r.fehler}`);
      return { ok: true };
    }),

  /** Empfänger-Vorschlaege (Kunden + bisherige Korrespondenten). */
  kontakte: authedQuery
    .input(z.object({ q: z.string().optional() }))
    .query(async ({ input }) => {
      const db = getDb();
      const q = input.q?.trim().toLowerCase() ?? "";
      const kartei = await db.query.kontakte.findMany();
      const ausKartei = kartei
        .filter((k) => !q || k.name.toLowerCase().includes(q) || k.email.toLowerCase().includes(q))
        .map((k) => ({ name: k.name, email: k.email, quelle: "kartei" as const }));
      const kunden = await db.query.customers.findMany();
      const ausKunden = kunden
        .filter((k) => k.email && (!q || k.name.toLowerCase().includes(q) || k.email.toLowerCase().includes(q)))
        .map((k) => ({ name: k.name, email: k.email!, quelle: "kunde" as const }));
      const mails = await db
        .select({ name: mailMails.absenderName, email: mailMails.absenderAdresse })
        .from(mailMails);
      const ausMails = mails
        .filter((m) => m.email && (!q || (m.name ?? "").toLowerCase().includes(q) || m.email.toLowerCase().includes(q)))
        .map((m) => ({ name: m.name ?? m.email!, email: m.email!, quelle: "mail" as const }));
      const gesehen = new Set<string>();
      return [...ausKartei, ...ausKunden, ...ausMails].filter((k) => {
        const key = k.email.toLowerCase();
        if (gesehen.has(key)) return false;
        gesehen.add(key);
        return true;
      }).slice(0, 20);
    }),

  /** Mail/Anhang als Eingangsbeleg anlegen (Buchhaltungs-Kurzweg). */
  alsBeleg: authedQuery
    .input(z.object({ mailId: z.number(), anhangIndex: z.number().int().min(0).optional() }))
    .mutation(({ input }) => import("./lib/mailBeleg").then((m) => m.alsBelegIntern(input.mailId, input.anhangIndex))),

  /** Auto-Routing-Regeln: CRUD. */
  regeln: authedQuery.query(async () => {
    const { mailRegeln } = await import("@db/schema");
    const { asc } = await import("drizzle-orm");
    return getDb().select().from(mailRegeln).orderBy(asc(mailRegeln.prio));
  }),

  regelAnlegen: authedQuery
    .input(
      z.object({
        pattern: z.string().min(1).max(500),
        feld: z.enum(["absender", "betreff"]).default("absender"),
        postTyp: z.enum(["rechnung", "sonstiges"]).default("rechnung"),
        kategorieId: z.number().nullable().optional(),
        prio: z.number().int().min(1).max(999).default(10),
      }),
    )
    .mutation(async ({ input }) => {
      const { mailRegeln } = await import("@db/schema");
      const [{ id }] = await getDb().insert(mailRegeln).values(input).$returningId();
      return { ok: true, id };
    }),

  regelLoeschen: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const { mailRegeln } = await import("@db/schema");
      await getDb().delete(mailRegeln).where(eq(mailRegeln.id, input.id));
      return { ok: true };
    }),

  regelUmschalten: authedQuery
    .input(z.object({ id: z.number(), aktiv: z.boolean() }))
    .mutation(async ({ input }) => {
      const { mailRegeln } = await import("@db/schema");
      await getDb().update(mailRegeln).set({ aktiv: input.aktiv }).where(eq(mailRegeln.id, input.id));
      return { ok: true };
    }),

  /** Entwürfe beim Verfassen. */
  entwuerfe: authedQuery.query(async () => {
    const { mailEntwuerfe } = await import("@db/schema");
    const { desc } = await import("drizzle-orm");
    return getDb().select().from(mailEntwuerfe).orderBy(desc(mailEntwuerfe.updatedAt)).limit(20);
  }),

  entwurfSpeichern: authedQuery
    .input(
      z.object({
        id: z.number().optional(),
        empfaenger: z.string().max(500).optional(),
        cc: z.string().max(500).optional(),
        bcc: z.string().max(500).optional(),
        kontoId: z.number().optional(),
        betreff: z.string().max(500).optional(),
        text: z.string().optional(),
        anhaenge: z.array(z.object({ dateiname: z.string(), base64: z.string(), mime: z.string() })).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { mailEntwuerfe } = await import("@db/schema");
      const db = getDb();
      const werte = {
        empfaenger: input.empfaenger ?? null,
        cc: input.cc ?? null,
        bcc: input.bcc ?? null,
        kontoId: input.kontoId ?? null,
        betreff: input.betreff ?? null,
        text: input.text ?? null,
        anhaenge: input.anhaenge?.length ? JSON.stringify(input.anhaenge) : null,
      };
      if (input.id) {
        await db.update(mailEntwuerfe).set(werte).where(eq(mailEntwuerfe.id, input.id));
        return { ok: true, id: input.id };
      }
      const [{ id }] = await db.insert(mailEntwuerfe).values(werte).$returningId();
      return { ok: true, id };
    }),

  entwurfLoeschen: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const { mailEntwuerfe } = await import("@db/schema");
      await getDb().delete(mailEntwuerfe).where(eq(mailEntwuerfe.id, input.id));
      return { ok: true };
    }),
});
