// ── iCalendar-Parser (v1.21.0, Bus #128.1): Outlook-Terminmails lesbar ─────
// Minimal-Parser für text/calendar (Einladung/Änderung/Absage): Titel, Beginn,
// Ende, Ort, Methode (REQUEST/CANCEL) — renderbar in der Mail-Ansicht.

export interface ICalEvent {
  titel: string;
  beginn: string; // JJJJ-MM-TT SS:MM (lokal formatiert) oder Datum
  ende: string | null;
  ort: string | null;
  uid: string | null;
  status: string | null;
}

export interface ICalDaten {
  methode: string | null; // REQUEST / CANCEL / PUBLISH
  events: ICalEvent[];
}

function datumWert(v: string): string {
  // 20260924T120000Z / 20260924T120000 / 20260924 → lesbar
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/);
  if (!m) return v;
  const datum = `${m[1]}-${m[2]}-${m[3]}`;
  return m[4] ? `${datum} ${m[4]}:${m[5]}` : datum;
}

function feld(block: string, name: string): string | null {
  const m = block.match(new RegExp(`^${name}(?:;[^:]*)?:(.+)$`, "m"));
  if (!m) return null;
  return m[1].trim().replace(/\\,/g, ",").replace(/\\n/gi, " ");
}

/** Findet iCalendar-Inhalt in Mail-Text/HTML/Anhang-Mime. */
export function enthaeltICal(text: string | null | undefined, anhaenge: { mime?: string }[]): boolean {
  if (anhaenge?.some((a) => a.mime === "text/calendar")) return true;
  return Boolean(text && /BEGIN:VCALENDAR/i.test(text));
}

export function parseICal(text: string): ICalDaten {
  const methode = feld(text, "METHOD");
  const bloecke = [...text.matchAll(/BEGIN:VEVENT([\s\S]*?)END:VEVENT/gi)].map((m) => m[1]);
  const events: ICalEvent[] = bloecke.map((b) => {
    const dtstart = feld(b, "DTSTART");
    const dtend = feld(b, "DTEND");
    return {
      titel: feld(b, "SUMMARY") ?? "(ohne Titel)",
      beginn: dtstart ? datumWert(dtstart) : "?",
      ende: dtend ? datumWert(dtend) : null,
      ort: feld(b, "LOCATION"),
      uid: feld(b, "UID"),
      status: feld(b, "STATUS"),
    };
  });
  return { methode, events };
}

/** Kurztext für die Mail-Ansicht (z. B. „Termin-Einladung: Physio, 24.09. 10:00, Praxisraum 2"). */
export function beschreibeICal(d: ICalDaten): string {
  const teile = d.events.map((e) => `${e.titel} — ${e.beginn}${e.ende ? ` bis ${e.ende}` : ""}${e.ort ? `, ${e.ort}` : ""}`);
  const art = d.methode === "CANCEL" ? "Termin-Absage" : d.methode === "REQUEST" ? "Termin-Einladung" : "Termin";
  return `${art}: ${teile.join(" · ")}`;
}
