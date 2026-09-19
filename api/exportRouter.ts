// ── Exporte: XRechnung (XML) + DATEV (Buchungsstapel CSV) ───────────────────
import { z } from "zod";
import { authedQuery, createRouter } from "./middleware";
import { getDb } from "./queries/connection";
import { invoices, creditNotes, customers, companySettings, incomingInvoices, postEingang, bankTransaktionen, kategorien } from "@db/schema";
import { eq, and, gte, lte, isNull, sql } from "drizzle-orm";
import { erzeugeXrechnung } from "./xrechnung";
import { ladeFirmaLive } from "./pdfBelege";
import { erzeugeBuchungsstapel, type DatevBuchung } from "./datev";
import { computeTotals } from "@contracts/invoicing";

/** DATEV-Buchungsstapel (Rechnungsausgang + Gutschriften + Eingangsbelege +
    kategorisierte Bank-Buchungen) für einen Zeitraum — geteilt mit der Agent-API. */
export async function baueDatevStapel(von: string, bis: string, opt?: { nurFreigegebene?: boolean }) {

    const db = getDb();
    const s = await db.query.companySettings.findFirst({
      where: eq(companySettings.id, 1),
    });
    if (!s) throw new Error("Firmen-Einstellungen fehlen.");

    const [rechnungen, gutschriften, kunden] = await Promise.all([
      db.query.invoices.findMany({
        where: and(
          eq(invoices.status, "finalisiert"),
          gte(invoices.rechnungsdatum, von),
          lte(invoices.rechnungsdatum, bis),
        ),
        with: { items: true },
      }),
      db.query.creditNotes.findMany({
        where: and(
          eq(creditNotes.status, "finalisiert"),
          gte(creditNotes.datum, von),
          lte(creditNotes.datum, bis),
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
          belegBase64: incomingInvoices.belegBase64,
          belegMime: incomingInvoices.belegMime,
          postLieferantId: postEingang.absenderLieferantId,
        })
        .from(incomingInvoices)
        .leftJoin(postEingang, eq(incomingInvoices.id, postEingang.incomingInvoiceId))
        .where(
          and(
            gte(incomingInvoices.rechnungsdatum, von),
            lte(incomingInvoices.rechnungsdatum, bis),
            ...(opt?.nurFreigegebene ? [eq(incomingInvoices.freigabe, "freigegeben")] : []),
          ),
        ),
    ]);

    const hinweise: string[] = [];
    if (opt?.nurFreigegebene) {
      const [{ n }] = await db
        .select({ n: sql<number>`COUNT(*)` })
        .from(incomingInvoices)
        .where(
          and(
            gte(incomingInvoices.rechnungsdatum, von),
            lte(incomingInvoices.rechnungsdatum, bis),
            sql`${incomingInvoices.freigabe} <> 'freigegeben'`,
          ),
        );
      if (Number(n) > 0) hinweise.push(`${Number(n)} Eingangsrechnung(en) NICHT exportiert (noch nicht freigegeben).`);
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

    // ── Belegbilder: Dateien fürs Beleg-ZIP sammeln (Referenz = Belegfeld 1) ──
    // + DATEV XML-Schnittstelle: GUID je Beleg (Beleglink ↔ document.xml)
    const { baueZip } = await import("./lib/zipWriter");
    const belegtransfer = await import("./lib/datevBelegtransferXml");
    const { belegGuid, baueDocumentXml } = belegtransfer;
    const belegDateien: { name: string; inhalt: Buffer }[] = [];
    const belegEintraege: import("./lib/datevBelegtransferXml").BelegEintrag[] = [];
    const sicher = (s: string) => s.replace(/[^\wäöüÄÖÜß.-]+/g, "_").slice(0, 60);
    const ext = (mime: string | null) =>
      mime === "application/pdf" ? "pdf" : mime?.includes("png") ? "png" : mime?.includes("jpeg") || mime?.includes("jpg") ? "jpg" : "bin";

    for (const r of rechnungen) {
      const deb = await debitorFuer(r.customerId);
      // Rechnungs-PDF erzeugen (GoBD-PDF wie im UI-Download)
      let belegDatei: string | undefined;
      try {
        const { ladeRechnungsBeleg, ladeDesign } = await import("./pdfBelege");
        const { renderBelegPdf } = await import("./pdf");
        const { beleg, dateiname } = await ladeRechnungsBeleg(r.id);
        const pdf = await renderBelegPdf(beleg, await ladeDesign());
        belegDatei = `RE-${sicher(r.nummer ?? String(r.id))}.pdf`;
        belegDateien.push({ name: belegDatei, inhalt: pdf });
        void dateiname;
      } catch { /* PDF optional — Stapel bleibt gültig */ }
      const guid = belegDatei ? belegGuid(`rechnung-${r.id}`) : undefined;
      if (belegDatei && guid) belegEintraege.push({ guid, dateiname: belegDatei, typ: 2 });
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
          belegDatei,
          belegGuid: guid,
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
      // Eingangsbeleg-Datei (aus GoBD-Archiv in der DB)
      let belegDatei: string | undefined;
      if (e.belegBase64) {
        belegDatei = `ER-${sicher(e.nummer)}.${ext(e.belegMime)}`;
        belegDateien.push({ name: belegDatei, inhalt: Buffer.from(e.belegBase64, "base64") });
      }
      const guid = belegDatei ? belegGuid(`eingangsrechnung-${e.id}`) : undefined;
      if (belegDatei && guid) belegEintraege.push({ guid, dateiname: belegDatei, typ: 1 });
      buchungen.push({
        debitornummer: 0,
        belegdatum: e.rechnungsdatum,
        belegfeld1: e.nummer,
        buchungstext: `Eingangsrechnung ${e.nummer} ${e.lieferantName}`.slice(0, 60),
        betragCent: Math.round(Number(e.brutto) * 100),
        ustSatz: 0,
        belegDatei,
        belegGuid: guid,
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

    // ── Kategorisierte Bank-Buchungen ohne Belegbezug (z. B. POS ohne Rechnung):
    // Soll Kategorie-Konto an Bank (Gegenkonto = company_settings.bank_konto).
    const bankZeilen = await db
      .select()
      .from(bankTransaktionen)
      .where(
        and(
          gte(bankTransaktionen.datum, von),
          lte(bankTransaktionen.datum, bis),
          sql`${bankTransaktionen.kategorieId} IS NOT NULL`,
          isNull(bankTransaktionen.invoiceId),
          isNull(bankTransaktionen.incomingInvoiceId),
        ),
      );
    const kategorienAlle = await db.select().from(kategorien);
    const katById = new Map(kategorienAlle.map((k) => [k.id, k]));
    let bankAnzahl = 0;
    for (const t of bankZeilen) {
      const kat = t.kategorieId ? katById.get(t.kategorieId) : undefined;
      const ust = kat?.ustSatz ?? 0;
      const bu = ust === 19 ? "9" : ust === 7 ? "8" : "";
      buchungen.push({
        debitornummer: 0,
        belegdatum: t.datum,
        belegfeld1: `BANK-${t.id}`,
        buchungstext: `Bank ${t.name}${kat ? ` (${kat.name})` : ""}`.slice(0, 60),
        betragCent: Math.round(Number(t.betrag) * 100),
        ustSatz: 0,
        direkt: {
          konto: kat?.konto ?? standardAufwand,
          gegenkonto: s.bankKonto ?? "1200",
          bu,
        },
      });
      bankAnzahl++;
    }
    if (bankAnzahl > 0) hinweise.push(`${bankAnzahl} kategorisierte Bank-Buchung(en) mit exportiert.`);

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
      von,
      bis,
      buchungen,
    );

    // ── Beleg-ZIP (Belegbilder): PDFs/Scans, benannt nach Belegfeld 1 ────────
    let belegeZipBase64: string | undefined;
    let belegeDateiname: string | undefined;
    if (belegDateien.length > 0) {
      // Duplikate zusammenführen (mehrere Buchungszeilen teilen denselben Beleg)
      const einzigartig = new Map(belegDateien.map((d) => [d.name, d.inhalt]));
      // DATEV XML-Schnittstelle: document.xml dazu (Belegtransfer-kompatibel)
      const documentXml = baueDocumentXml(belegEintraege, `ReWaWi Belege ${von} bis ${bis}`);
      const zip = baueZip([
        { name: "document.xml", inhalt: Buffer.from(documentXml, "utf8") },
        ...[...einzigartig.entries()].map(([name, inhalt]) => ({ name, inhalt })),
      ]);
      belegeZipBase64 = zip.toString("base64");
      belegeDateiname = `EXTF_Belege_${von}_${bis}.zip`;
      hinweise.push(`${einzigartig.size} Belegdatei(en) im Beleg-ZIP inkl. document.xml (DATEV XML-Schnittstelle — per kostenlosem DATEV-Belegtransfer nach Unternehmen online; Verknüpfung via Beleglink BEDI-GUID).`);
    }

    return {
      dateiname: `EXTF_Buchungsstapel_${von}_${bis}.csv`,
      csv,
      anzahlBuchungen: buchungen.length,
      hinweise,
      belegeZipBase64,
      belegeDateiname,
      anzahlBelege: new Set(belegDateien.map((d) => d.name)).size,
    };

}

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
          rabattArt: it.rabattArt as "prozent" | "festwert" | null,
          rabattWert: it.rabattWert,
          einheit: it.einheit,
          einzelpreis: it.einzelpreis,
          ustSatz: it.ustSatz,
        })),
        hauptrabattArt: r.hauptrabattArt as "prozent" | "festwert" | null,
        hauptrabattWert: r.hauptrabattWert,
        rabattAddieren: r.rabattAddieren,
      });

      return {
        dateiname: `XRechnung ${r.nummer}.xml`,
        xml,
      };
    }),


  /** DATEV-Buchungsstapel für einen Zeitraum (UI). */
  datevBuchungsstapel: authedQuery
    .input(
      z.object({
        von: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        bis: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        nurFreigegebene: z.boolean().optional(),
      }),
    )
    .query(({ input }) => baueDatevStapel(input.von, input.bis, { nurFreigegebene: input.nurFreigegebene })),

  /** Monatspaket für die Kanzlei: Stapel + Beleg-ZIP + EÜR + OP-Listen als Anhang-Satz. */
  stbPaket: authedQuery
    .input(
      z.object({
        von: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        bis: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
    )
    .mutation(async ({ input }) => {
      const anhaenge: { dateiname: string; base64: string; mime: string }[] = [];
      // 1) DATEV-Stapel + Beleg-ZIP
      const stapel = await baueDatevStapel(input.von, input.bis);
      anhaenge.push({ dateiname: stapel.dateiname, base64: Buffer.from(stapel.csv, "utf8").toString("base64"), mime: "text/csv" });
      if (stapel.belegeZipBase64 && stapel.belegeDateiname) {
        anhaenge.push({ dateiname: stapel.belegeDateiname, base64: stapel.belegeZipBase64, mime: "application/zip" });
      }
      // 2) EÜR + Debitoren als PDF (Berichts-Engine)
      const { baueBericht } = await import("./lib/berichte");
      const { renderBerichtPdf } = await import("./lib/berichtPdf");
      for (const id of ["euer", "debitoren", "kreditoren"] as const) {
        try {
          const b = await baueBericht(id, { von: input.von, bis: input.bis });
          const pdf = await renderBerichtPdf(b);
          anhaenge.push({ dateiname: `${id}_${input.von}_${input.bis}.pdf`, base64: pdf.toString("base64"), mime: "application/pdf" });
        } catch { /* einzelner Bericht optional */ }
      }
      return {
        anhaenge,
        anzahlBuchungen: stapel.anzahlBuchungen,
        hinweise: stapel.hinweise,
      };
    }),
});
