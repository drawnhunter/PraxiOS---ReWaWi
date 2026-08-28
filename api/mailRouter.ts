// ── E-Mail-Versand (SMTP, generisch) ───────────────────────────────────────
// Belege als PDF (optional + XRechnung-XML) direkt aus der App versenden,
// mit Versandprotokoll in mail_log.
import { z } from "zod";
import { authedQuery, createRouter } from "./middleware";
import { getDb } from "./queries/connection";
import { mailLog, invoices, customers, offers, creditNotes } from "@db/schema";
import { eq, desc } from "drizzle-orm";
import { ladeSmtp } from "./lib/smtp";
import { renderBelegPdf } from "./pdf";
import {
  ladeRechnungsBeleg,
  ladeAngebotsBeleg,
  ladeGutschriftsBeleg,
  ladeMahnungsBeleg,
  ladeDesign,
} from "./pdfBelege";
import { erzeugeXrechnung } from "./xrechnung";
import { ladeFirmaLive } from "./pdfBelege";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LadeFn = (id: number) => Promise<any>;
const ARTIKEL: Record<string, { titel: string; lade: LadeFn }> = {
  invoice: { titel: "Rechnung", lade: ladeRechnungsBeleg },
  offer: { titel: "Angebot", lade: ladeAngebotsBeleg },
  credit: { titel: "Gutschrift", lade: ladeGutschriftsBeleg },
  reminder: { titel: "Zahlungserinnerung", lade: ladeMahnungsBeleg },
};
type BelegArt = keyof typeof ARTIKEL;


function ersetzePlatzhalter(text: string, werte: Record<string, string>): string {
  return Object.entries(werte).reduce(
    (t, [k, v]) => t.replaceAll(`{${k}}`, v),
    text,
  );
}

async function ladeVorlagenWerte(art: BelegArt, id: number) {
  const firma = await ladeFirmaLive();

  if (art === "reminder") {
    const m = await getDb().query.reminders.findFirst({
      where: (t, { eq: e }) => e(t.id, id),
      with: { invoice: true },
    });
    if (!m) throw new Error("Mahnung nicht gefunden.");
    const r = m.invoice;
    const werte = {
      nummer: r.nummer ?? `#${r.id}`,
      firma: firma.name,
      datum: m.datum.split("-").reverse().join("."),
      betrag: `${Number(m.offenBetrag).toFixed(2).replace(".", ",")} EUR`,
      kunde: r.kundeName,
    };
    return { beleg: null, werte, firmaEmail: firma.email, kundeName: r.kundeName };
  }

  const { beleg } = await ARTIKEL[art].lade(id);
  return {
    beleg,
    werte: {
      nummer: beleg.nummer,
      firma: beleg.firma.name,
      datum: beleg.datum.split("-").reverse().join("."),
      betrag: `${((beleg as { totals?: { bruttoCent: number } }).totals?.bruttoCent
        ? ((beleg as never as { totals: { bruttoCent: number } }).totals.bruttoCent / 100)
        : 0
      ).toFixed(2).replace(".", ",")} EUR`,
      kunde: beleg.kunde.name,
    },
    firmaEmail: firma.email,
    kundeName: beleg.kunde.name,
  };
}

export const mailRouter = createRouter({
  // SMTP-Verbindung pruefen
  smtpTest: authedQuery.mutation(async () => {
    const { transporter } = await ladeSmtp();
    await transporter.verify();
    return { ok: true };
  }),

  // Vorausgefuellte Mail (Betreff/Text/Empfaenger) fuer den Dialog
  vorlage: authedQuery
    .input(z.object({ art: z.enum(["invoice", "offer", "credit", "reminder"]), id: z.number() }))
    .query(async ({ input }) => {
      const { werte, firmaEmail, kundeName } = await ladeVorlagenWerte(input.art, input.id);
      const titel = ARTIKEL[input.art].titel;
      const kundenRow = await getDb().query.customers.findFirst({
        where: (k, { eq: e }) => e(k.name, kundeName),
      });
      const betreff =
        input.art === "reminder"
          ? ersetzePlatzhalter("Zahlungserinnerung zu Rechnung {nummer}", werte)
          : ersetzePlatzhalter(`${titel} {nummer} von {firma}`, werte);
      const text =
        input.art === "reminder"
          ? ersetzePlatzhalter(
              `Guten Tag ${werte.kunde},\n\ntrotz freundlicher Erinnerung ist die Zahlung für Rechnung {nummer} über {betrag} bei uns noch nicht eingegangen. Anbei erhalten Sie die Zahlungserinnerung vom {datum}.\n\nBei Fragen stehen wir Ihnen gerne zur Verfügung.\n\nMit freundlichen Grüßen\n{firma}`,
              werte,
            )
          : ersetzePlatzhalter(
              `Guten Tag ${werte.kunde},\n\nanbei erhalten Sie ${titel.toLowerCase()} {nummer} vom {datum} über {betrag}.\n\nBei Fragen stehen wir Ihnen gerne zur Verfügung.\n\nMit freundlichen Grüßen\n{firma}`,
              werte,
            );
      return {
        empfaenger: kundenRow?.email ?? "",
        betreff,
        text,
        firmaEmail,
        xrechnungMoeglich: input.art === "invoice" && (await ladeVorlagenWerte(input.art, input.id)).beleg?.istEntwurf === false,
      };
    }),

  // Beleg versenden
  senden: authedQuery
    .input(
      z.object({
        art: z.enum(["invoice", "offer", "credit", "reminder"]),
        id: z.number(),
        empfaenger: z.string().email("Gültige E-Mail-Adresse nötig"),
        betreff: z.string().min(1).max(500),
        text: z.string().min(1).max(10000),
        mitXrechnung: z.boolean().default(false),
        alsStandard: z.boolean().default(false),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const art = ARTIKEL[input.art];
      let pdf: Buffer;
      let dateiname: string;
      if (input.art === "reminder") {
        const m = await ladeMahnungsBeleg(input.id);
        pdf = m.pdf;
        dateiname = m.dateiname;
      } else {
        const { beleg, dateiname: dn } = await art.lade(input.id);
        const design = await ladeDesign();
        pdf = await renderBelegPdf(beleg, design);
        dateiname = dn;
      }

      const anhaenge: { filename: string; content: Buffer; contentType?: string }[] = [
        { filename: `${art.titel} ${dateiname}.pdf`, content: pdf, contentType: "application/pdf" },
      ];

      if (input.mitXrechnung && input.art === "invoice") {
        const r = await db.query.invoices.findFirst({
          where: eq(invoices.id, input.id),
          with: { items: true, bankAccount: true },
        });
        if (r && r.status !== "entwurf") {
          const firma = await ladeFirmaLive();
          const kundeRow = await db.query.customers.findFirst({
            where: eq(customers.id, r.customerId),
          });
          const snap = r.firmenSnapshot ? JSON.parse(r.firmenSnapshot) : null;
          const bankSnap = r.bankSnapshot ? JSON.parse(r.bankSnapshot) : null;
          const xml = erzeugeXrechnung({
            nummer: r.nummer!,
            rechnungsdatum: r.rechnungsdatum,
            faelligkeitsdatum: r.faelligkeitsdatum,
            leistungsdatum: r.leistungsdatum,
            firma: {
              name: (snap?.name ?? firma.name) as string,
              strasse: (snap?.strasse ?? firma.strasse) as string,
              plz: (snap?.plz ?? firma.plz) as string,
              ort: (snap?.ort ?? firma.ort) as string,
              land: (snap?.land ?? firma.land) as string,
              email: (snap?.email ?? firma.email ?? null) as string | null,
              telefon: (snap?.telefon ?? firma.telefon ?? null) as string | null,
              steuernummer: (snap?.steuernummer ?? firma.steuernummer ?? null) as string | null,
              ustIdNr: (snap?.ustIdNr ?? firma.ustIdNr ?? null) as string | null,
              handelsregister: (snap?.handelsregister ?? firma.handelsregister ?? null) as string | null,
            },
            kunde: {
              name: r.kundeName, strasse: r.kundeStrasse, plz: r.kundePlz,
              ort: r.kundeOrt, land: r.kundeLand,
              // Die im Versand-Dialog eingetragene Adresse hat Vorrang (dorthin geht die Mail)
              email: input.empfaenger || kundeRow?.email || null,
            },
            bank: bankSnap?.iban
              ? { iban: bankSnap.iban, bic: bankSnap.bic ?? null }
              : r.bankAccount?.iban
                ? { iban: r.bankAccount.iban, bic: r.bankAccount.bic }
                : null,
            items: r.items.map((it) => ({
              bezeichnung: it.bezeichnung, menge: it.menge, einheit: it.einheit,
              einzelpreis: it.einzelpreis, ustSatz: it.ustSatz,
              rabattArt: it.rabattArt as "prozent" | "festwert" | null,
              rabattWert: it.rabattWert,
            })),
            hauptrabattArt: r.hauptrabattArt as "prozent" | "festwert" | null,
            hauptrabattWert: r.hauptrabattWert,
            rabattAddieren: r.rabattAddieren,
          });
          anhaenge.push({
            filename: `XRechnung ${r.nummer}.xml`,
            content: Buffer.from(xml, "utf8"),
            contentType: "application/xml",
          });
        }
      }

      const { transporter, absender } = await ladeSmtp();
      let erfolg = true;
      let fehler: string | null = null;
      try {
        await transporter.sendMail({
          from: `"${absender}" <${(await ladeFirmaLive()).email ?? absender}>`,
          to: input.empfaenger,
          subject: input.betreff,
          text: input.text,
          attachments: anhaenge,
        });
      } catch (e) {
        erfolg = false;
        fehler = e instanceof Error ? e.message : String(e);
      }

      await db.insert(mailLog).values({
        belegArt: input.art,
        belegId: input.id,
        empfaenger: input.empfaenger,
        betreff: input.betreff,
        erfolg,
        fehler,
      });

      if (!erfolg) throw new Error(`Versand fehlgeschlagen: ${fehler}`);

      // Optional: Dialog-Adresse als Standard-E-Mail des Kunden hinterlegen
      if (input.alsStandard && input.art !== "reminder") {
        try {
          const belegRow = input.art === "invoice"
            ? await db.query.invoices.findFirst({ where: eq(invoices.id, input.id) })
            : input.art === "offer"
              ? await db.query.offers.findFirst({ where: eq(offers.id, input.id) })
              : await db.query.creditNotes.findFirst({ where: eq(creditNotes.id, input.id) });
          const kundenId = (belegRow as { customerId?: number } | undefined)?.customerId;
          if (kundenId) {
            const kundeRow = await db.query.customers.findFirst({ where: eq(customers.id, kundenId) });
            if (kundeRow && kundeRow.email !== input.empfaenger) {
              await db.update(customers).set({ email: input.empfaenger }).where(eq(customers.id, kundenId));
            }
          }
        } catch (e) {
          console.error("[mail] Standard-Adresse speichern fehlgeschlagen:", e);
        }
      }
      return { ok: true };
    }),

  // Versandprotokoll je Beleg
  protokoll: authedQuery
    .input(z.object({ art: z.string(), id: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      return db
        .select()
        .from(mailLog)
        .where(eq(mailLog.belegArt, input.art))
        .orderBy(desc(mailLog.gesendetAm))
        .limit(10);
    }),
});
