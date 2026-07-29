// ICS-Feed „Zahlungsziele“: baut den Kalender (VEVENTs) fuer das ICS-Abo.
import { and, isNotNull, isNull, eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { incomingInvoices, postEingang, suppliers } from "@db/schema";

function icsDatum(iso: string): string {
  return iso.replaceAll("-", "");
}

function plusTag(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function geldFmt(v: string): string {
  return Number(v).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

export async function baueZahlungszieleIcs(): Promise<string> {
  const db = getDb();
  const events: string[] = [];
  const jetzt = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+/, "");

  const offene = await db
    .select({
      id: incomingInvoices.id,
      lieferantName: incomingInvoices.lieferantName,
      nummer: incomingInvoices.nummer,
      brutto: incomingInvoices.brutto,
      faelligkeitsdatum: incomingInvoices.faelligkeitsdatum,
    })
    .from(incomingInvoices)
    .where(and(isNull(incomingInvoices.bezahltAm), isNotNull(incomingInvoices.faelligkeitsdatum)));

  for (const r of offene) {
    events.push(
      [
        "BEGIN:VEVENT",
        `UID:eingangsrechnung-${r.id}@rewawi`,
        `DTSTAMP:${jetzt}`,
        `DTSTART;VALUE=DATE:${icsDatum(r.faelligkeitsdatum!)}`,
        `DTEND;VALUE=DATE:${icsDatum(plusTag(r.faelligkeitsdatum!))}`,
        `SUMMARY:${esc(`Zahlung fällig: ${r.lieferantName} — ${r.nummer} (${geldFmt(r.brutto)})`)}`,
        "END:VEVENT",
      ].join("\r\n"),
    );
  }

  const posts = await db
    .select({
      id: postEingang.id,
      stichwort: postEingang.stichwort,
      wiedervorlageAm: postEingang.wiedervorlageAm,
      status: postEingang.status,
      lieferantName: suppliers.name,
      absenderFreitext: postEingang.absenderFreitext,
    })
    .from(postEingang)
    .leftJoin(suppliers, eq(postEingang.absenderLieferantId, suppliers.id))
    .where(and(isNotNull(postEingang.wiedervorlageAm), eq(postEingang.status, "neu")));

  for (const p of posts) {
    const absender = p.lieferantName ?? p.absenderFreitext ?? "";
    events.push(
      [
        "BEGIN:VEVENT",
        `UID:wiedervorlage-${p.id}@rewawi`,
        `DTSTAMP:${jetzt}`,
        `DTSTART;VALUE=DATE:${icsDatum(p.wiedervorlageAm!)}`,
        `DTEND;VALUE=DATE:${icsDatum(plusTag(p.wiedervorlageAm!))}`,
        `SUMMARY:${esc(`Wiedervorlage: ${p.stichwort ?? "Dokument"}${absender ? " — " + absender : ""}`)}`,
        "END:VEVENT",
      ].join("\r\n"),
    );
  }

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//PraxiOS//ReWaWi Zahlungsziele//DE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:ReWaWi Zahlungsziele",
    ...events,
    "END:VCALENDAR",
  ].join("\r\n");
}
