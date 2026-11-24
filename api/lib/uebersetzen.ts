// ── Übersetzung via selbst-gehostetem LibreTranslate (v1.22.1) ─────────────
// Der Container läuft bereits auf Alexanders Server (praxiswerk-translate).
// Kein Mailtext verlässt das Haus — Datenschutz bleibt intakt.

/** Sehr einfache Sprachheuristik: Stopwort-Verhältnis Deutsch vs. Englisch. */
export function erkenneSprache(text: string): "de" | "en" | "unbekannt" {
  const w = text.toLowerCase().slice(0, 8000);
  const zaehle = (liste: string[]) => liste.reduce((a, wort) => a + (w.match(new RegExp(`\\b${wort}\\b`, "g"))?.length ?? 0), 0);
  const de = zaehle(["der", "die", "das", "und", "ist", "mit", "für", "eine", "einer", "nicht", "sehr", "geehrte", "danke", "bitte", "auf", "von", "zu"]);
  const en = zaehle(["the", "and", "is", "are", "with", "for", "hello", "thanks", "please", "this", "that", "have", "you", "your", "we", "not"]);
  if (de >= 4 && de > en * 1.5) return "de";
  if (en >= 4 && en > de * 1.5) return "en";
  return "unbekannt";
}

/** HTML zu lesbarem Text (Absatzstruktur bleibt erhalten). */
export function htmlZuLesetext(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface UebersetzungsErgebnis {
  ok: boolean;
  text?: string;
  fehler?: string;
}

/** Übersetzt Text über die lokale LibreTranslate-Instanz.
 *  v1.22.2: URL-Fallback-Kette — Container-Name, Docker-Host-Gateway und LAN-IP
 *  werden nacheinander probiert (Compose-Netzwerke sind getrennt), die erste
 *  funktionierende Adresse wird in den Einstellungen persistiert. */
export async function uebersetzeText(text: string, ziel = "de", quelle = "auto"): Promise<UebersetzungsErgebnis> {
  const { companySettings } = await import("@db/schema");
  const { getDb } = await import("../queries/connection");
  const { eq } = await import("drizzle-orm");
  const db = getDb();
  const settings = await db.query.companySettings.findFirst({ where: eq(companySettings.id, 1) });
  const kandidaten = [
    settings?.libretranslateUrl || null,
    "http://praxiswerk-translate:5000",
    "http://host.docker.internal:5000",
    "http://192.168.178.62:5000",
  ].filter((u): u is string => Boolean(u));

  const fehler: string[] = [];
  for (const basisRoh of kandidaten) {
    const basis = basisRoh.replace(/\/$/, "");
    const url = `${basis}/translate`;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: text.slice(0, 15000), source: quelle, target: ziel, format: "text" }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) { fehler.push(`${basis}: HTTP ${res.status}`); continue; }
      const json = (await res.json()) as { translatedText?: string; error?: string };
      if (json.error) { fehler.push(`${basis}: ${json.error}`); continue; }
      if (!json.translatedText) { fehler.push(`${basis}: leere Antwort`); continue; }
      // funktionierende Adresse merken — nächste Aufrufe gehen direkt dorthin
      if (settings?.libretranslateUrl !== basis) {
        await db.update(companySettings).set({ libretranslateUrl: basis }).where(eq(companySettings.id, 1)).catch(() => undefined);
      }
      return { ok: true, text: json.translatedText };
    } catch (e) {
      fehler.push(`${basis}: ${e instanceof Error && e.name === "AbortError" ? "Zeitüberschreitung (12 s)" : "nicht erreichbar"}`);
    }
  }
  return {
    ok: false,
    fehler: `LibreTranslate auf keiner Adresse erreichbar — ${fehler.join(" · ")}. Bitte Container prüfen (docker ps | grep translate) und ob Port 5000 für ReWaWi erreichbar ist (getrennte Compose-Netzwerke).`,
  };
}
