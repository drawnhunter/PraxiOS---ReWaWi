// ── Exporte: XRechnung (XML) + DATEV (Buchungsstapel CSV) ───────────────────
import { z } from "zod";
import { authedQuery, createRouter } from "./middleware";
import { getDb } from "./queries/connection";
import { invoices, creditNotes, customers, companySettings, incomingInvoices, postEingang } from "@db/schema";
import { eq, and, gte, lte } from "drizzle-orm";
import { erzeugeXrechnung } from "./xrechnung";
import { ladeFirmaLive } from "./pdfBelege";
import { erzeugeBuchungsstapel, type DatevBuchung } from "./datev";
import { computeTotals } from "@contracts/invoicing";

export const exportRouter = createRouter({
  xrechnungRechnung: authedQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const r = await getDb().query.invoices.findFirst({
        where: eq(invoices.id, input.id),
        with: { items: true, bankAccount: true },
      });
      if (!r) throw new Error("Rechnung nicht gefunden.");
      if (r.status === "entwurf") {
        throw new Error("XRechnung gibt es erst nach dem Finalisieren (Entwürfe haben keine Rechnungsnummer).");
      }
      r.items.sort((a, b) => a.position - b.position);

      // Stammdaten: bei finalisierten Rechnungen Snapshot bevorzugen
      const snap = r.firmenSnapshot ? JSON.parse(r.firmenSnapshot) : null;
      const live = snap ? null : await ladeFirmaLive();
      const firma = {
        name: (snap?.name ?? live?.name) as string,
        strasse: (snap?.strasse ?? live?.strasse) as string,
        plz: (snap?.plz ?? live?.plz) as string,
        ort: (snap?.ort ?? live?.ort) as string,
        land: (snap?.land ?? live?.land) as string,
        email: (snap?.email ?? live?.email ?? null) as string | null,
        telefon: (snap?.telefon ?? live?.telefon ?? null) as string | null,
        steuernummer: (snap?.steuernummer ?? live?.steuernummer ?? null) as string | null,
        ustIdNr: (snap?.ustIdNr ?? live?.ustIdNr ?? null) as string | null,
        handelsregister: (snap?.handelsregister ?? live?.handelsregister ?? null) as string | null,
      };

      const kundeRow = await getDb().query.customers.findFirst({
        where: (k, { eq: eqFn }) => eqFn(k.id, r.customerId),
      });

      const bankSnap = r.bankSnapshot ? JSON.parse(r.bankSnapshot) : null;
      const bank = bankSnap?.iban
        ? { iban: bankSnap.iban as string, bic: (bankSnap.bic ?? null) as string | null }
        : r.bankAccount?.iban
          ? { iban: r.bankAccount.iban, bic: r.bankAccount.bic }
          : null;

      const xml = erzeugeXrechnung({
        nummer: r.nummer!,
        rechnungsdatum: r.rechnungsdatum,
        faelligkeitsdatum: r.faelligkeitsdatum,
        leistungsdatum: r.leistungsdatum,
        firma,
        kunde: {
          name: r.kundeName,
          strasse: r.kundeStrasse,
          plz: r.kundePlz,
          ort: r.kundeOrt,
          land: r.kundeLand,
          email: kundeRow?.email ?? null,
        },
        bank,
        items: r.items.map((it) => ({
          bezeichnung: it.bezeichnung,
          menge: it.menge,
          einheit: it.einheit,
          einzelpreis: it.einzelpreis,
          ustSatz: it.ustSatz,
        })),
      });

      return {
        dateiname: `XRechnung ${r.nummer}.xml`,
        xml,
      };
    }),

  /** DATEV-Buchungsstapel (Rechnungsausgang + Gutschriften) für einen Zeitraum. */
  datevBuchungsstapel: authedQuery
    .input(
      z.object({
        von: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        bis: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const s = await db.query.companySettings.findFirst({
        where: eq(companySettings.id, 1),
      });
      if (!s) throw new Error("Firmen-Einstellungen fehlen.");

      const [rechnungen, gutschriften, kunden] = await Promise.all([
        db.query.invoices.findMany({
          where: and(
            eq(invoices.status, "finalisiert"),
            gte(invoices.rechnungsdatum, input.von),
            lte(invoices.rechnungsdatum, input.bis),
          ),
          with: { items: true },
        }),
        db.query.creditNotes.findMany({
          where: and(
            eq(creditNotes.status, "finalisiert"),
            gte(creditNotes.datum, input.von),
            lte(creditNotes.datum, input.bis),
          ),
          with: { items: true, invoice: true },
        }),
        db.query.customers.findMany(),
      ]);

      const [eingaenge] = await Promise.all([
        db
          .select({
            id: incomingInvoices.id,
            lieferantName: incomingInvoices.lieferantName,
            nummer: incomingInvoices.nummer,
            rechnungsdatum: incomingInvoices.rechnungsdatum,
            netto: incomingInvoices.netto,
            ust: incomingInvoices.ust,
            brutto: incomingInvoices.brutto,
            konto: incomingInvoices.konto,
            gegenkonto: incomingInvoices.gegenkonto,
            postLieferantId: postEingang.absenderLieferantId,
          })
          .from(incomingInvoices)
          .leftJoin(postEingang, eq(incomingInvoices.id, postEingang.incomingInvoiceId))
          .where(
            and(
              gte(incomingInvoices.rechnungsdatum, input.von),
              lte(incomingInvoices.rechnungsdatum, input.bis),
            ),
          ),
      ]);

      const hinweise: string[] = [];
      if (rechnungen.length === 0 && gutschriften.length === 0 && eingaenge.length === 0) {
        throw new Error("Keine finalisierten Rechnungen, Gutschriften oder Eingangsrechnungen im Zeitraum.");
      }

      // ── Debitornummern vergeben (einmalig, persistent) ──────────────────
      const kundeById = new Map(kunden.map((k) => [k.id, k]));
      let naechste = Math.max(
        s.debitorStartnummer,
        ...kunden.map((k) => (k.debitornummer ?? 0) + 1),
        s.debitorStartnummer,
      );
      const debitorFuer = async (customerId: number): Promise<number> => {
        const k = kundeById.get(customerId);
        if (k?.debitornummer) return k.debitornummer;
        const nr = naechste++;
        await db.update(customers).set({ debitornummer: nr }).where(eq(customers.id, customerId));
        if (k) k.debitornummer = nr;
        hinweise.push(`Kunde „${k?.name ?? customerId}“ erhielt Debitornummer ${nr}.`);
        return nr;
      };

      const buchungen: DatevBuchung[] = [];

      for (const r of rechnungen) {
        const deb = await debitorFuer(r.customerId);
        const totals = computeTotals(
          r.items.map((it) => ({ einzelpreis: it.einzelpreis, menge: it.menge, ustSatz: it.ustSatz })),
        );
        for (const u of totals.ustProSatz) {
          buchungen.push({
            debitornummer: deb,
            belegdatum: r.rechnungsdatum,
            belegfeld1: r.nummer ?? String(r.id),
            buchungstext: `Rechnung ${r.nummer ?? r.id} ${r.kundeName}`,
            betragCent: u.basisCent + u.betragCent,
            ustSatz: u.satz,
          });
        }
      }

      for (const g of gutschriften) {
        const deb = await debitorFuer(g.invoice.customerId);
        const totals = computeTotals(
          g.items.map((it) => ({ einzelpreis: it.einzelpreis, menge: it.menge, ustSatz: it.ustSatz })),
        );
        for (const u of totals.ustProSatz) {
          buchungen.push({
            debitornummer: deb,
            belegdatum: g.datum,
            belegfeld1: g.nummer ?? String(g.id),
            buchungstext: `Gutschrift ${g.nummer ?? g.id} zu ${g.invoice.nummer ?? g.invoiceId} ${g.kundeName}`,
            betragCent: -(u.basisCent + u.betragCent),
            ustSatz: u.satz,
          });
        }
      }

      // ── Eingangsrechnungen: Soll Aufwandskonto an Kreditor (BU 9 = 19 % VSt,
      // 8 = 7 % VSt). Kreditor = Startnummer + Lieferanten-ID, sonst Sammelkonto.
      const sammelKreditor = s.datevKontenrahmen === "SKR04" ? "3300" : "1600";
      const standardAufwand =
        s.aufwandskontoDefault ?? (s.datevKontenrahmen === "SKR04" ? "6305" : "4900");
      for (const e of eingaenge) {
        const netto = Number(e.netto);
        const ust = Number(e.ust);
        const satz = netto > 0 ? Math.round((ust / netto) * 100) : 0;
        const bu = ust <= 0 ? "" : satz === 19 ? "9" : satz === 7 ? "8" : "";
        const kreditor = e.postLieferantId
          ? String(s.kreditorStartnummer + e.postLieferantId)
          : sammelKreditor;
        buchungen.push({
          debitornummer: 0,
          belegdatum: e.rechnungsdatum,
          belegfeld1: e.nummer,
          buchungstext: `Eingangsrechnung ${e.nummer} ${e.lieferantName}`.slice(0, 60),
          betragCent: Math.round(Number(e.brutto) * 100),
          ustSatz: 0,
          direkt: {
            konto: e.konto ?? standardAufwand,
            gegenkonto: e.gegenkonto ?? kreditor,
            bu,
          },
        });
      }
      if (eingaenge.length > 0) {
        hinweise.push(`${eingaenge.length} Eingangsrechnung(en) mit exportiert.`);
      }

      buchungen.sort((a, b) => a.belegdatum.localeCompare(b.belegdatum));

      const csv = erzeugeBuchungsstapel(
        {
          beraternummer: s.datevBeraternummer ?? "",
          mandantennummer: s.datevMandantennummer ?? "",
          kontenrahmen: s.datevKontenrahmen,
          erloeskonto19: s.erloeskonto19,
          erloeskonto7: s.erloeskonto7,
          erloeskonto0: s.erloeskonto0,
        },
        input.von,
        input.bis,
        buchungen,
      );

      return {
        dateiname: `EXTF_Buchungsstapel_${input.von}_${input.bis}.csv`,
        csv,
        anzahlBuchungen: buchungen.length,
        hinweise,
      };
    }),
});
