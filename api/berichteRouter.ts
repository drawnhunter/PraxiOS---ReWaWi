// ── Berichtszentrale (tRPC): Katalog, Bericht als JSON, Bericht als PDF ────
import { z } from "zod";
import { authedQuery, createRouter } from "./middleware";
import { BERICHT_KATALOG, baueBericht } from "./lib/berichte";
import { getDb } from "./queries/connection";

const params = z.object({
  von: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  bis: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kontoId: z.number().optional(),
  satz: z.number().min(1).max(60).optional(),
});

export const berichteRouter = createRouter({
  katalog: authedQuery.query(() => BERICHT_KATALOG),

  bericht: authedQuery
    .input(params.extend({ id: z.string() }))
    .query(async ({ input }) => {
      const { id, ...p } = input;
      return baueBericht(id, p);
    }),

  pdf: authedQuery
    .input(params.extend({ id: z.string() }))
    .query(async ({ input }) => {
      const { id, ...p } = input;
      const bericht = await baueBericht(id, p);
      const { renderBerichtPdf } = await import("./lib/berichtPdf");
      const pdf = await renderBerichtPdf(bericht);
      const datei = `${bericht.id}_${bericht.zeitraum.von}_${bericht.zeitraum.bis}.pdf`.replaceAll("—", "-");
      return { dateiname: datei, base64: pdf.toString("base64") };
    }),

  /** Konten für die Kontenblatt-Auswahl. */
  /**
   * Kontierungsübersicht für die Kanzlei (v1.21.12): welche SKR-Konten werden im
   * Zeitraum tatsächlich verwendet und mit welchen Summen? Einnahmen aus
   * finalisierten Rechnungen (Erlöskonten nach USt-Satz), Ausgaben aus
   * Eingangsrechnungen (konto-Feld der Belege).
   */
  kontierungen: authedQuery
    .input(z.object({
      von: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      bis: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }))
    .query(async ({ input }) => {
      const db = getDb();
      const { invoices, invoiceItems, incomingInvoices, companySettings } = await import("@db/schema");
      const { and, eq, gte, lte } = await import("drizzle-orm");

      const settings = await db.query.companySettings.findFirst({ where: eq(companySettings.id, 1) });
      const rahmen = settings?.datevKontenrahmen ?? "SKR03";
      const erloes = {
        19: settings?.erloeskonto19 ?? "8400",
        7: settings?.erloeskonto7 ?? "8300",
        0: settings?.erloeskonto0 ?? "8120",
      } as Record<number, string>;

      const zeilen: { konto: string; typ: "einnahme" | "ausgabe"; anzahl: number; netto: number; ust: number; brutto: number }[] = [];
      const schluessel = new Map<string, (typeof zeilen)[number]>();
      const add = (konto: string | null, typ: "einnahme" | "ausgabe", netto: number, ust: number, brutto: number) => {
        const k = `${typ}|${konto ?? "(ohne Kontierung)"}`;
        if (!schluessel.has(k)) schluessel.set(k, { konto: konto ?? "(ohne Kontierung)", typ, anzahl: 0, netto: 0, ust: 0, brutto: 0 });
        const z = schluessel.get(k)!;
        z.anzahl += 1;
        z.netto = Math.round((z.netto + netto) * 100) / 100;
        z.ust = Math.round((z.ust + ust) * 100) / 100;
        z.brutto = Math.round((z.brutto + brutto) * 100) / 100;
      };

      // Einnahmen: finalisierte Rechnungen, Positionen je USt-Satz aufs Erlöskonto
      const ausgaenge = await db
        .select({ r: invoices, it: invoiceItems })
        .from(invoices)
        .innerJoin(invoiceItems, eq(invoiceItems.invoiceId, invoices.id))
        .where(and(eq(invoices.status, "finalisiert"), gte(invoices.rechnungsdatum, input.von), lte(invoices.rechnungsdatum, input.bis)));
      const satzNetto = new Map<string, { konto: string; netto: number; ust: number }>();
      for (const a of ausgaenge) {
        const konto = erloes[a.it.ustSatz] ?? erloes[19];
        const key = `${a.r.id}|${konto}`;
        if (!satzNetto.has(key)) satzNetto.set(key, { konto, netto: 0, ust: 0 });
        const s = satzNetto.get(key)!;
        const netto = Number(a.it.menge) * Number(a.it.einzelpreis);
        s.netto += netto;
        s.ust += netto * (a.it.ustSatz / 100);
      }
      for (const s of satzNetto.values()) {
        add(s.konto, "einnahme", s.netto, s.ust, s.netto + s.ust);
      }

      // Ausgaben: Eingangsrechnungen nach konto-Feld gruppiert
      const eingaenge = await db
        .select()
        .from(incomingInvoices)
        .where(and(gte(incomingInvoices.rechnungsdatum, input.von), lte(incomingInvoices.rechnungsdatum, input.bis)));
      for (const e of eingaenge) {
        add(e.konto, "ausgabe", Number(e.netto), Number(e.ust), Number(e.brutto));
      }

      return {
        kontenrahmen: rahmen,
        von: input.von,
        bis: input.bis,
        zeilen: zeilen.sort((a, b) => a.typ === b.typ ? a.konto.localeCompare(b.konto) : a.typ === "einnahme" ? -1 : 1),
      };
    }),

  konten: authedQuery.query(async () => {
    const { bankAccounts } = await import("@db/schema");
    const { getDb } = await import("./queries/connection");
    const rows = await getDb().select().from(bankAccounts);
    return rows.map((k) => ({ id: k.id, bezeichnung: k.bezeichnung, iban: k.iban }));
  }),
});
