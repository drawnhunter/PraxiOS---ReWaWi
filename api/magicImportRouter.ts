// ── Magic Import: eine Upload-Tür für alles ────────────────────────────────
// Erkennt den Dateityp und leitet weiter: E-Rechnungen werden gebucht, Scans
// landen im Post Manager, CSVs werden erkannt und zum passenden Import gelotst.
import { z } from "zod";
import { authedQuery, createRouter } from "./middleware";
import { analysiereXrechnung } from "./xrechnungEinlesen";
import { extrahiereXmlAusPdf } from "./zugferdPdf";
import { bucheEingangsrechnungAusXml } from "./lib/einrechnung";
import { erzeugePostEingang, mimeAusName } from "./lib/posteingang";

const ROUTEN = ["erechnung", "post", "kunden", "produkte", "bank", "unbekannt"] as const;
type Route = (typeof ROUTEN)[number];

const dateiInput = z.object({
  name: z.string().min(1).max(255),
  base64: z.string().min(4),
});

function csvRoute(kopfzeile: string): Route {
  const h = kopfzeile.toLowerCase();
  if (h.includes("tax rate") || h.includes("item name")) return "produkte";
  if (h.includes("ländercode") || h.includes("zahlungsbedingungen")) return "kunden";
  if (
    h.includes("buchungstag") ||
    h.includes("wertstellung") ||
    h.includes("verwendungszweck") ||
    h.includes("betrag") ||
    h.includes("iban")
  )
    return "bank";
  return "unbekannt";
}

interface Analyse {
  name: string;
  route: Route;
  hinweis: string;
  xml?: string;
  meta?: { lieferant?: string; nummer?: string; brutto?: string };
}

function analysiereDatei(name: string, puffer: Buffer): Analyse {
  const lower = name.toLowerCase();

  if (lower.endsWith(".xml")) {
    const xml = puffer.toString("utf8");
    const { daten, fehler } = analysiereXrechnung(xml);
    if (daten && fehler.length === 0) {
      return {
        name,
        route: "erechnung",
        hinweis: "XRechnung — wird direkt gebucht",
        xml,
        meta: { lieferant: daten.lieferant, nummer: daten.nummer, brutto: daten.brutto.toFixed(2) },
      };
    }
    return { name, route: "unbekannt", hinweis: "XML ist keine gültige E-Rechnung" };
  }

  if (lower.endsWith(".pdf")) {
    const xml = extrahiereXmlAusPdf(puffer);
    if (xml) {
      const { daten, fehler } = analysiereXrechnung(xml);
      if (daten && fehler.length === 0) {
        return {
          name,
          route: "erechnung",
          hinweis: "ZUGFeRD-PDF — XML erkannt, wird direkt gebucht",
          xml,
          meta: { lieferant: daten.lieferant, nummer: daten.nummer, brutto: daten.brutto.toFixed(2) },
        };
      }
    }
    return { name, route: "post", hinweis: "PDF-Scan — geht in den Post Manager" };
  }

  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".png")) {
    return { name, route: "post", hinweis: "Bild/Scan — geht in den Post Manager" };
  }

  if (lower.endsWith(".csv")) {
    const kopf = puffer.toString("utf8").split("\n")[0] ?? "";
    const route = csvRoute(kopf);
    const hinweise: Record<Route, string> = {
      erechnung: "",
      post: "",
      kunden: "SumUp-Kundenexport erkannt",
      produkte: "SumUp-Produktexport erkannt",
      bank: "Bank-/Kontoauszug erkannt",
      unbekannt: "CSV-Format nicht erkannt",
    };
    return { name, route, hinweis: hinweise[route] };
  }

  return { name, route: "unbekannt", hinweis: "Dateityp wird nicht unterstützt" };
}

export const magicImportRouter = createRouter({
  analysieren: authedQuery
    .input(z.object({ dateien: z.array(dateiInput).min(1).max(10) }))
    .mutation(async ({ input }) => {
      return input.dateien.map((d) => analysiereDatei(d.name, Buffer.from(d.base64, "base64")));
    }),

  ausfuehren: authedQuery
    .input(
      z.object({
        dateien: z
          .array(
            dateiInput.extend({
              route: z.enum(ROUTEN),
              postTyp: z.enum(["rechnung", "sonstiges"]).default("rechnung"),
            }),
          )
          .min(1)
          .max(10),
      }),
    )
    .mutation(async ({ input }) => {
      const ergebnisse: {
        name: string;
        ok: boolean;
        ziel: string;
        id?: number;
        fehler?: string;
        weiter?: string;
      }[] = [];

      for (const d of input.dateien) {
        const puffer = Buffer.from(d.base64, "base64");
        try {
          if (d.route === "erechnung") {
            const analyse = analysiereDatei(d.name, puffer);
            if (!analyse.xml) throw new Error("Keine E-Rechnung (XML) gefunden.");
            const { id, lieferant, nummer } = await bucheEingangsrechnungAusXml(analyse.xml);
            ergebnisse.push({ name: d.name, ok: true, ziel: `E-Rechnung gebucht: ${lieferant} — ${nummer}`, id });
          } else if (d.route === "post") {
            const id = await erzeugePostEingang({
              originalname: d.name,
              mime: mimeAusName(d.name),
              puffer,
              typ: d.postTyp,
              quelle: "Magic Import",
            });
            ergebnisse.push({ name: d.name, ok: true, ziel: "im Post Manager abgelegt", id });
          } else if (d.route === "kunden" || d.route === "produkte" || d.route === "bank") {
            const ziele: Record<string, string> = {
              kunden: "/kunden",
              produkte: "/produkte",
              bank: "/bank",
            };
            ergebnisse.push({
              name: d.name,
              ok: true,
              ziel: "erkannt — bitte im Zielbereich importieren (Vorschau & Mapping)",
              weiter: ziele[d.route],
            });
          } else {
            ergebnisse.push({ name: d.name, ok: false, ziel: "", fehler: "Nicht importierbar (unbekannter Typ)." });
          }
        } catch (e) {
          ergebnisse.push({
            name: d.name,
            ok: false,
            ziel: "",
            fehler: e instanceof Error ? e.message : String(e),
          });
        }
      }
      return ergebnisse;
    }),
});
