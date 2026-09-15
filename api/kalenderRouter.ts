// ── Kalender: CRUD, Monatsdaten, ICS-Feed (Google-Abo) ──────────────────────
import { z } from "zod";
import { authedQuery, createRouter } from "./middleware";
import { getDb } from "./queries/connection";
import { termine } from "@db/schema";
import { and, asc, eq, gte, lte } from "drizzle-orm";

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

export function baueKalenderIcs(rows: (typeof termine.$inferSelect)[]): string {
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
      const rows = await getDb()
        .select()
        .from(termine)
        .where(and(gte(termine.datum, von), lte(termine.datum, bis)))
        .orderBy(asc(termine.datum), asc(termine.startZeit));
      return { monat: input.monat, termine: rows };
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
    const rows = await getDb().select().from(termine).orderBy(asc(termine.datum)).limit(2000);
    return { ics: baueKalenderIcs(rows), anzahl: rows.length };
  }),
});
