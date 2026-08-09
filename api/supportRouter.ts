// ── Support-Meldungen ──────────────────────────────────────────────────────
// In-App-Support: Nutzer koennen Fragen/Probleme/Ideen/Fehler direkt aus der
// App melden. Zwei Versandwege:
//   1. SupportHub (wenn ein Support-Schluessel hinterlegt ist) — Ticket wird
//      direkt im Dienstleister-Terminal angelegt, Paket-Status sichtbar.
//   2. SMTP (Fallback und Standard ohne Schluessel) — klassische E-Mail.
// Jede Meldung wird lokal protokolliert (support_meldungen).
import { z } from "zod";
import { authedQuery, adminQuery, createRouter } from "./middleware";
import { getDb } from "./queries/connection";
import { companySettings, supportMeldungen } from "@db/schema";
import { eq, desc } from "drizzle-orm";
import { ladeSmtp } from "./lib/smtp";
import { APP_VERSION } from "./lib/version";

const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || "drawn.hunter@proton.me";
const PRODUKT = process.env.SUPPORT_PRODUKT || "ReWaWi";
const HUB_URL = (process.env.SUPPORT_HUB_URL || "https://support.praxios.dynv6.net").replace(/\/$/, "");

const TYP_LABELS: Record<string, string> = {
  frage: "Frage",
  problem: "Problem",
  idee: "Idee/Wunsch",
  fehler: "Fehlermeldung",
};

type HubStatus = { ok: boolean; kunde?: string; produkt?: string; paket?: string; fehler?: string };

async function hubAufruf(pfad: string, init?: RequestInit): Promise<HubStatus> {
  const res = await fetch(HUB_URL + "/api/hub" + pfad, {
    ...init,
    signal: AbortSignal.timeout(6000),
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const daten = (await res.json()) as HubStatus;
  if (typeof daten?.ok !== "boolean") {
    return { ok: false, fehler: "Unerwartete Antwort vom SupportHub." };
  }
  return daten;
}

async function ladeSettings() {
  return getDb().query.companySettings.findFirst({
    where: eq(companySettings.id, 1),
  });
}

export const supportRouter = createRouter({
  status: authedQuery.query(async () => {
    const s = await ladeSettings();
    const hatSchluessel = Boolean(s?.supportSchluessel);
    let hub: HubStatus | null = null;
    if (hatSchluessel && s?.supportSchluessel) {
      try {
        hub = await hubAufruf(`/status?schluessel=${encodeURIComponent(s.supportSchluessel)}`);
        if (!hub.ok) hub = null;
      } catch {
        hub = null; // Hub nicht erreichbar — Verbindung gilt als vorhanden, aber offline
      }
    }
    return {
      smtpBereit: Boolean(s?.smtpHost && s?.smtpUser),
      supportEmail: SUPPORT_EMAIL,
      instanz: s?.name?.trim() || "",
      version: APP_VERSION,
      produkt: PRODUKT,
      verbunden: hatSchluessel,
      hubErreichbar: hub?.ok ?? false,
      paket: hub?.paket ?? null,
      kunde: hub?.kunde ?? null,
    };
  }),

  schluesselSpeichern: adminQuery
    .input(z.object({ schluessel: z.string().trim().min(10).max(80) }))
    .mutation(async ({ input }) => {
      // Schluessel erst gegen den Hub pruefen, damit keine vertippten
      // oder ungueltigen Schluessel gespeichert werden
      let hub: HubStatus;
      try {
        hub = await hubAufruf(`/status?schluessel=${encodeURIComponent(input.schluessel)}`);
      } catch {
        throw new Error(
          `SupportHub nicht erreichbar (${HUB_URL}). Bitte Verbindung pruefen oder spaeter erneut versuchen.`,
        );
      }
      if (!hub.ok) {
        throw new Error(hub.fehler || "Schluessel wurde vom SupportHub abgelehnt.");
      }
      await getDb()
        .update(companySettings)
        .set({ supportSchluessel: input.schluessel })
        .where(eq(companySettings.id, 1));
      return { ok: true, kunde: hub.kunde ?? null, paket: hub.paket ?? null };
    }),

  schluesselTrennen: adminQuery.mutation(async () => {
    await getDb()
      .update(companySettings)
      .set({ supportSchluessel: null })
      .where(eq(companySettings.id, 1));
    return { ok: true };
  }),

  senden: authedQuery
    .input(
      z.object({
        typ: z.enum(["frage", "problem", "idee", "fehler"]),
        betreff: z.string().trim().min(3).max(200),
        nachricht: z.string().trim().min(10).max(5000),
        kontext: z.string().max(4000).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const s = await ladeSettings();
      const instanz = s?.name?.trim() || "Unbekannte Instanz";
      const benutzer = ctx.user?.name || ctx.user?.username || "unbekannt";

      let kanal = "smtp";
      let status: "gesendet" | "fehlgeschlagen" = "gesendet";
      let fehler: string | null = null;
      let ticketId: number | null = null;

      // Weg 1: SupportHub (wenn verbunden)
      if (s?.supportSchluessel) {
        try {
          const hub = await hubAufruf("/report", {
            method: "POST",
            body: JSON.stringify({
              schluessel: s.supportSchluessel,
              produkt: PRODUKT,
              version: APP_VERSION,
              typ: input.typ,
              betreff: input.betreff,
              nachricht: `${input.nachricht}\n\n(gemeldet von Benutzer: ${benutzer})`,
              kontext: input.kontext,
              instanz,
            }),
          });
          if (hub.ok) {
            kanal = "hub";
            ticketId = (hub as { ticketId?: number }).ticketId ?? null;
          } else {
            throw new Error(hub.fehler || "Hub hat die Meldung abgelehnt.");
          }
        } catch (e) {
          // Hub-Weg gescheitert — auf SMTP zurueckfallen
          fehler = `Hub-Versand fehlgeschlagen (${e instanceof Error ? e.message : e}) — SMTP-Fallback genutzt.`;
        }
      }

      // Weg 2: SMTP (Standard ohne Schluessel oder als Fallback)
      if (kanal === "smtp") {
        const betreffZeile = `[PraxiOS-Support|${PRODUKT}|${instanz}|${TYP_LABELS[input.typ]}] ${input.betreff}`;
        const text = [
          `Produkt: ${PRODUKT} v${APP_VERSION}`,
          `Instanz: ${instanz}`,
          `Benutzer: ${benutzer}`,
          `Typ: ${TYP_LABELS[input.typ]}`,
          `Zeitpunkt: ${new Date().toISOString()}`,
          "",
          "── Nachricht ──",
          input.nachricht,
          ...(input.kontext ? ["", "── Technischer Kontext ──", input.kontext] : []),
        ].join("\n");
        try {
          const { transporter, absender } = await ladeSmtp();
          await transporter.sendMail({
            from: absender,
            to: SUPPORT_EMAIL,
            replyTo: absender,
            subject: betreffZeile,
            text,
          });
          status = "gesendet";
        } catch (e) {
          status = "fehlgeschlagen";
          const smtpFehler = e instanceof Error ? e.message : String(e);
          fehler = fehler ? `${fehler} SMTP ebenfalls: ${smtpFehler}` : smtpFehler;
        }
      } else {
        status = "gesendet";
      }

      await getDb().insert(supportMeldungen).values({
        typ: input.typ,
        betreff: input.betreff,
        nachricht: input.nachricht,
        kontext: input.kontext ?? null,
        benutzer,
        instanz,
        version: APP_VERSION,
        status,
        fehler: fehler ? fehler.slice(0, 500) : null,
      });

      if (status === "fehlgeschlagen") {
        throw new Error(
          `Versand fehlgeschlagen (${fehler}). Die Meldung wurde lokal gespeichert — alternativ direkt an ${SUPPORT_EMAIL} schreiben.`,
        );
      }
      return { ok: true, kanal, ticketId };
    }),

  liste: authedQuery.query(async () => {
    return getDb().query.supportMeldungen.findMany({
      orderBy: [desc(supportMeldungen.createdAt)],
      limit: 20,
    });
  }),
});
