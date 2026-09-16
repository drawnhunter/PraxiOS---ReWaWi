// ── Kalender: CRUD, Monatsdaten, ICS-Feed (Google-Abo) ──────────────────────
import { z } from "zod";
import { authedQuery, createRouter } from "./middleware";
import { getDb } from "./queries/connection";
import { termine } from "@db/schema";
import { and, asc, eq, gte, lte, or } from "drizzle-orm";

const terminInput = z.object({
  datum: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startZeit: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  endZeit: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  titel: z.string().min(1).max(255),
  beschreibung: z.string().nullable().optional(),
  farbe: z.string().max(12).nullable().optional(),
  mailId: z.number().nullable().optional(),
});

function icsEscape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function icsDatumZeit(datum: string, zeit: string | null): { dtstart: string; dtend?: string; ganztaegig: boolean } {
  if (!zeit) {
    return { dtstart: `;VALUE=DATE:${datum.replaceAll("-", "")}`, ganztaegig: true };
  }
  return { dtstart: `:${datum.replaceAll("-", "")}T${zeit.replace(":", "")}00`, ganztaegig: false };
}

export interface QuellEintrag {
  art: "mahnung" | "ausgang_offen" | "eingang" | "post" | "wiedervorlage";
  id: number;
  datum: string;
  titel: string;
  betrag: string | null;
  ueberfaellig: boolean;
  link: string;
}

/** Quell-Eintraege (Zahlungsziele + Mahnungen + offene Rechnungen) fuer einen Zeitraum. */
export async function ladeQuellEintraege(von: string, bis: string): Promise<QuellEintrag[]> {
  const db = getDb();
  const heute = new Date().toISOString().slice(0, 10);
  const { invoices, incomingInvoices, reminders, postEingang, suppliers } = await import("@db/schema");
  const { isNull, isNotNull } = await import("drizzle-orm");

  const aus: QuellEintrag[] = [];

  // Mahnungen (Zahlungserinnerungen mit Frist)
  const mahnungen = await db
    .select({ m: reminders, nummer: invoices.nummer, kunde: invoices.kundeName })
    .from(reminders)
    .leftJoin(invoices, eq(reminders.invoiceId, invoices.id))
    .where(and(gte(reminders.zahlungsfrist, von), lte(reminders.zahlungsfrist, bis)));
  for (const r of mahnungen) {
    aus.push({
      art: "mahnung",
      id: r.m.invoiceId,
      datum: r.m.zahlungsfrist,
      titel: `Mahnung Stufe ${r.m.stufe} — ${r.nummer ?? `#${r.m.invoiceId}`} (${r.kunde ?? "?"})`,
      betrag: r.m.offenBetrag,
      ueberfaellig: r.m.zahlungsfrist < heute,
      link: `/rechnungen/${r.m.invoiceId}`,
    });
  }

  // Offene Ausgangsrechnungen (ueberfaellig oder faellig im Zeitraum)
  const offene = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.status, "finalisiert"), gte(invoices.faelligkeitsdatum, von), lte(invoices.faelligkeitsdatum, bis)));
  for (const r of offene) {
    const offen = Number(r.brutto) - Number(r.bezahltBetrag);
    if (offen <= 0.004) continue;
    aus.push({
      art: "ausgang_offen",
      id: r.id,
      datum: r.faelligkeitsdatum,
      titel: `Offen: ${r.nummer ?? `#${r.id}`} (${r.kundeName})`,
      betrag: offen.toFixed(2),
      ueberfaellig: r.faelligkeitsdatum < heute,
      link: `/rechnungen/${r.id}`,
    });
  }

  // Eingangsrechnungen mit Fälligkeit (Zahlungsziele)
  const eingaenge = await db
    .select()
    .from(incomingInvoices)
    .where(and(isNull(incomingInvoices.bezahltAm), isNotNull(incomingInvoices.faelligkeitsdatum), gte(incomingInvoices.faelligkeitsdatum, von), lte(incomingInvoices.faelligkeitsdatum, bis)));
  for (const r of eingaenge) {
    aus.push({
      art: "eingang",
      id: r.id,
      datum: r.faelligkeitsdatum!,
      titel: `Zahlen: ${r.lieferantName} — ${r.nummer}`,
      betrag: r.brutto,
      ueberfaellig: r.faelligkeitsdatum! < heute,
      link: "/e-rechnungen",
    });
  }

  // Postmanager: Wiedervorlagen + fällige Posts
  const posts = await db
    .select({ p: postEingang, lieferantName: suppliers.name })
    .from(postEingang)
    .leftJoin(suppliers, eq(postEingang.absenderLieferantId, suppliers.id))
    .where(
      and(
        or(isNotNull(postEingang.faelligAm), isNotNull(postEingang.wiedervorlageAm)),
        or(eq(postEingang.status, "neu"), eq(postEingang.status, "abgelegt")),
      ),
    );
  for (const { p, lieferantName } of posts) {
    const absender = lieferantName ?? p.absenderFreitext ?? "Unbekannt";
    if (p.wiedervorlageAm && p.wiedervorlageAm >= von && p.wiedervorlageAm <= bis && p.status !== "abgelegt") {
      aus.push({
        art: "wiedervorlage",
        id: p.id,
        datum: p.wiedervorlageAm,
        titel: `Wiedervorlage: ${p.stichwort ?? p.typ} — ${absender}`,
        betrag: null,
        ueberfaellig: p.wiedervorlageAm < heute,
        link: "/posteingang",
      });
    }
    if (p.faelligAm && p.faelligAm >= von && p.faelligAm <= bis && p.typ === "rechnung" && p.status === "neu") {
      aus.push({
        art: "post",
        id: p.id,
        datum: p.faelligAm,
        titel: `Post: ${p.stichwort ?? "Rechnung"} — ${absender}`,
        betrag: p.betrag,
        ueberfaellig: p.faelligAm < heute,
        link: "/posteingang",
      });
    }
  }

  return aus.sort((a, b) => (a.datum < b.datum ? -1 : 1));
}

export function baueKalenderIcs(rows: (typeof termine.$inferSelect)[], quellen: QuellEintrag[] = []): string {
  const zeilen = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//PraxiOS ReWaWi//Kalender//DE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:ReWaWi Kalender`,
  ];
  for (const t of rows) {
    const dz = icsDatumZeit(t.datum, t.startZeit);
    zeilen.push("BEGIN:VEVENT");
    zeilen.push(`UID:termin-${t.id}@rewawi`);
    zeilen.push(`DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`);
    zeilen.push(`DTSTART${dz.dtstart}`);
    if (t.endZeit && t.startZeit) {
      zeilen.push(`DTEND:${t.datum.replaceAll("-", "")}T${t.endZeit.replace(":", "")}00`);
    } else if (dz.ganztaegig) {
      const ende = new Date(new Date(t.datum).getTime() + 86400000).toISOString().slice(0, 10).replaceAll("-", "");
      zeilen.push(`DTEND;VALUE=DATE:${ende}`);
    }
    zeilen.push(`SUMMARY:${icsEscape(t.titel)}`);
    if (t.beschreibung) zeilen.push(`DESCRIPTION:${icsEscape(t.beschreibung)}`);
    if (t.farbe) zeilen.push(`COLOR:${t.farbe}`);
    // Erinnerung (VALARM, absolut — wird von Google Kalender/Apple übernommen)
    if (t.erinnereAm) {
      const wann = new Date(t.erinnereAm).toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
      zeilen.push("BEGIN:VALARM");
      zeilen.push("ACTION:DISPLAY");
      zeilen.push(`TRIGGER;VALUE=DATE-TIME:${wann}`);
      zeilen.push(`DESCRIPTION:${icsEscape(t.titel)}`);
      zeilen.push("END:VALARM");
    }
    zeilen.push("END:VEVENT");
  }
  for (const q of quellen) {
    const ende = new Date(new Date(q.datum).getTime() + 86400000).toISOString().slice(0, 10).replaceAll("-", "");
    zeilen.push("BEGIN:VEVENT");
    zeilen.push(`UID:quelle-${q.art}-${q.id}@rewawi`);
    zeilen.push(`DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`);
    zeilen.push(`DTSTART;VALUE=DATE:${q.datum.replaceAll("-", "")}`);
    zeilen.push(`DTEND;VALUE=DATE:${ende}`);
    const prefix = q.art === "mahnung" ? "MAHNUNG" : q.art === "ausgang_offen" ? "OFFEN" : q.art === "eingang" ? "ZAHLEN" : q.art === "wiedervorlage" ? "WIEDERVORLAGE" : "POST";
    zeilen.push(`SUMMARY:${icsEscape(`${prefix}: ${q.titel}`)}`);
    if (q.betrag) zeilen.push(`DESCRIPTION:${icsEscape(`Betrag: ${q.betrag} € · ${q.link}`)}`);
    zeilen.push("END:VEVENT");
  }
  zeilen.push("END:VCALENDAR");
  return zeilen.join("\r\n") + "\r\n";
}

export const kalenderRouter = createRouter({
  monat: authedQuery
    .input(z.object({ monat: z.string().regex(/^\d{4}-\d{2}$/) }))
    .query(async ({ input }) => {
      const von = `${input.monat}-01`;
      const [jjjj, mm] = input.monat.split("-").map(Number);
      const bis = new Date(jjjj, mm, 0).toISOString().slice(0, 10);
      const db = getDb();
      const rows = await db
        .select()
        .from(termine)
        .where(and(gte(termine.datum, von), lte(termine.datum, bis)))
        .orderBy(asc(termine.datum), asc(termine.startZeit));
      const quellen = await ladeQuellEintraege(von, bis);
      return { monat: input.monat, termine: rows, quellen };
    }),

  liste: authedQuery.query(async () => {
    return getDb().select().from(termine).orderBy(asc(termine.datum), asc(termine.startZeit)).limit(500);
  }),

  anlegen: authedQuery.input(terminInput).mutation(async ({ input }) => {
    const [{ id }] = await getDb()
      .insert(termine)
      .values({ ...input, quelle: input.mailId ? "mail" : "manuell", erstelltVon: "mensch" })
      .$returningId();
    return { id };
  }),

  aktualisieren: authedQuery
    .input(terminInput.partial().extend({ id: z.number() }))
    .mutation(async ({ input }) => {
      const { id, ...rest } = input;
      const patch = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
      if (Object.keys(patch).length === 0) throw new Error("Nichts zu ändern.");
      await getDb().update(termine).set(patch).where(eq(termine.id, id));
      return { ok: true };
    }),

  loeschen: authedQuery.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await getDb().delete(termine).where(eq(termine.id, input.id));
    return { ok: true };
  }),

  ics: authedQuery.query(async () => {
    const db = getDb();
    const rows = await db.select().from(termine).orderBy(asc(termine.datum)).limit(2000);
    const quellen = await ladeQuellEintraege("2000-01-01", "2099-12-31");
    return { ics: baueKalenderIcs(rows, quellen), anzahl: rows.length + quellen.length };
  }),
});
