// ── Mail-Postfach: Ordner, Liste, Detail, Anhang, Sync ─────────────────────
// Liest aus mail_mails (DB, schnell + durchsuchbar). Anhaenge liegen (wenn
// PDF/JPG/PNG) im Post Manager; darauf verweist die Meta.
import { z } from "zod";
import { authedQuery, createRouter } from "./middleware";
import { getDb } from "./queries/connection";
import { mailMails, emailKonten, postEingang } from "@db/schema";
import { and, asc, desc, eq, like, or, sql } from "drizzle-orm";

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
  postfaecher: authedQuery.query(async () => {
    const db = getDb();
    const konten = await db.select().from(emailKonten).orderBy(asc(emailKonten.name));
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
      aus.push({
        id: k.id,
        name: k.name,
        benutzer: k.benutzer,
        aktiv: k.aktiv,
        letzterAbruf: k.letzterAbruf,
        letzterFehler: k.letzterFehler,
        ordner: ordner.map((o) => ({ name: o.ordner, anzahl: Number(o.anzahl), ungelesen: Number(o.ungelesen) })),
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
        von: z.string().optional(),
        bis: z.string().optional(),
        seite: z.number().int().min(1).default(1),
      }),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const bedingungen = [];
      if (input.kontoId) bedingungen.push(eq(mailMails.kontoId, input.kontoId));
      if (input.ordner) bedingungen.push(eq(mailMails.ordner, input.ordner));
      if (input.nurUngelesene) bedingungen.push(eq(mailMails.gelesen, false));
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
        .orderBy(desc(mailMails.datum), desc(mailMails.id))
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
    .query(async ({ input }) => {
      const db = getDb();
      const m = await db.query.mailMails.findFirst({ where: eq(mailMails.id, input.id) });
      if (!m) throw new Error("Mail nicht gefunden.");
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
    .mutation(async ({ input }) => {
      const { synchronisiereKonto } = await import("./imapDienst");
      return synchronisiereKonto(input.kontoId);
    }),
});
