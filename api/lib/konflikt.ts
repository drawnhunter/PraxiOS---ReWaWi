/**
 * Optimistic Locking (v1.21.8): Formular lädt Datensatz mit Version (updatedAt).
 * Beim Speichern prüft der Server, ob der Datensatz zwischenzeitlich verändert
 * wurde (anderer Tab, anderes Fenster, Agent-API). Konflikt → KONFLIKT-Fehler
 * statt stillem Überschreiben; der Client bietet „neu laden" ODER „erzwingen".
 */

export class KonfliktFehler extends Error {
  serverStand: string;
  constructor(serverStand: string) {
    super(`KONFLIKT: Dieser Datensatz wurde seit dem Laden des Formulars geändert (Server-Stand ${serverStand}). Quelle kann ein anderer Tab, ein anderes Fenster oder die Agent-API sein.`);
    this.name = "KonfliktFehler";
    this.serverStand = serverStand;
  }
}

export function pruefeVersion(
  datensatz: { updatedAt?: Date | string | null },
  version: string | null | undefined,
  erzwingen: boolean | undefined,
): void {
  if (erzwingen || !version || !datensatz.updatedAt) return;
  const clientMs = new Date(version).getTime();
  if (Number.isNaN(clientMs)) return;
  const server = datensatz.updatedAt instanceof Date ? datensatz.updatedAt : new Date(datensatz.updatedAt);
  // 1 s Toleranz: MySQL-DATETIME hat Sekundenpräzision
  if (server.getTime() > clientMs + 1000) {
    throw new KonfliktFehler(server.toISOString());
  }
}
