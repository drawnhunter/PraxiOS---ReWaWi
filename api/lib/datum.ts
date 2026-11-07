/**
 * Fachliche Kalenderdaten (Bus #191): Rechnungs-/Fälligkeitsdaten folgen der
 * Zeitzone Europe/Berlin, NICHT dem UTC-Tag. `new Date().toISOString()` liefert
 * kurz nach Mitternacht deutscher Zeit noch den Vortag — genau der gemeldete
 * Tagesversatz bei „sofort zahlbar".
 */

/** Heute als JJJJ-MM-TT in Europe/Berlin. */
export function heuteBerlin(): string {
  return datumBerlin(new Date());
}

/** Beliebiger Zeitpunkt als Kalenderdatum JJJJ-MM-TT in Europe/Berlin. */
export function datumBerlin(d: Date): string {
  // en-CA liefert JJJJ-MM-TT; die Einzelteile abgesichert selbst zusammensetzen
  const teile = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  const t = (typ: string) => teile.find((x) => x.type === typ)?.value ?? "";
  return `${t("year")}-${t("month")}-${t("day")}`;
}

/**
 * Reine Kalender-Arithmetik auf JJJJ-MM-TT (Sommer-/Winterzeit-sicher):
 * rechnet auf UTC-Mittag, damit kein Zeitzonen-Rand kippt.
 */
export function tageAddieren(iso: string, tage: number): string {
  const [j, m, tag] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(j, m - 1, tag, 12));
  d.setUTCDate(d.getUTCDate() + tage);
  return d.toISOString().slice(0, 10);
}
