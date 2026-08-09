import { authedQuery, createRouter } from "./middleware";
import { getDb } from "./queries/connection";
import { invoices } from "@db/schema";
import { gte } from "drizzle-orm";

export const dashboardRouter = createRouter({
  stats: authedQuery.query(async () => {
    const db = getDb();
    const alle = await db.select().from(invoices);

    const finalisiert = alle.filter((r) => r.status !== "entwurf");
    const heute = new Date().toISOString().slice(0, 10);
    const monatStart = heute.slice(0, 7) + "-01";

    const offene = finalisiert.filter((r) => {
      const bezahltCent = Math.round(Number(r.bezahltBetrag) * 100);
      const bruttoCent = Math.round(Number(r.brutto) * 100);
      return r.status === "finalisiert" && bezahltCent < bruttoCent;
    });

    const ueberfaellig = offene.filter((r) => r.faelligkeitsdatum < heute);

    const summe = (rows: typeof alle, f: (r: (typeof alle)[0]) => number) =>
      rows.reduce((a, r) => a + f(r), 0);

    const umsatzMonat = summe(
      finalisiert.filter((r) => r.rechnungsdatum >= monatStart),
      (r) => Number(r.brutto),
    );
    const offenGesamt = summe(
      offene,
      (r) => Number(r.brutto) - Number(r.bezahltBetrag),
    );

    const entwuerfe = alle.filter((r) => r.status === "entwurf").length;

    return {
      anzahlOffen: offene.length,
      anzahlUeberfaellig: ueberfaellig.length,
      offenGesamt,
      umsatzMonat,
      anzahlEntwuerfe: entwuerfe,
      anzahlFinalisiert: finalisiert.length,
      letzteRechnungen: alle
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .slice(0, 8),
    };
  }),

  recentPaid: authedQuery.query(async () => {
    const db = getDb();
    const start = new Date();
    start.setDate(start.getDate() - 30);
    const seit = start.toISOString().slice(0, 10);
    return db
      .select()
      .from(invoices)
      .where(gte(invoices.bezahltAm, seit));
  }),
});
