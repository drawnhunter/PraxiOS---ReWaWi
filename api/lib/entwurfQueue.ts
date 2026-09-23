// ── Sende-Queue für Entwürfe (v1.20): Undo-Send-Verzögerung + Senden-Später ─
// Ein Pfad für beides: geplantesSendenAm = jetzt+X s (Undo) oder Wunschzeitpunkt
// (Später senden). Ein 15s-Job holt fällige Ausgang-Zeilen ab und versendet.
import { eq, and, lte } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { mailEntwuerfe } from "@db/schema";

/** Entwurf versenden (geteilt von API + Queue). Erfolg → Zeile weg, Fehler → versandFehler. */
export async function sendeEntwurf(id: number): Promise<{ ok: boolean; fehler?: string }> {
  const db = getDb();
  const e = await db.query.mailEntwuerfe.findFirst({ where: eq(mailEntwuerfe.id, id) });
  if (!e) return { ok: false, fehler: "Entwurf nicht gefunden." };
  const empfaenger = (e.empfaenger ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  if (empfaenger.length === 0) {
    await db.update(mailEntwuerfe).set({ versandFehler: "Kein Empfänger angegeben." }).where(eq(mailEntwuerfe.id, id));
    return { ok: false, fehler: "Kein Empfänger angegeben." };
  }
  const { versendeMail } = await import("./mailVersand");
  const text = e.text ?? "";
  const r = await versendeMail({
    kontoId: e.kontoId ?? undefined,
    empfaenger,
    cc: e.cc ? e.cc.split(",").map((x) => x.trim()).filter(Boolean) : undefined,
    bcc: e.bcc ? e.bcc.split(",").map((x) => x.trim()).filter(Boolean) : undefined,
    betreff: e.betreff ?? "(kein Betreff)",
    text: text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || text,
    html: text.startsWith("<") ? text : undefined,
    anhaenge: e.anhaenge ? (JSON.parse(e.anhaenge) as { dateiname: string; base64: string; mime: string }[]) : undefined,
    inReplyTo: e.inReplyTo ?? null,
    mitSignatur: true,
  });
  if (!r.ok) {
    await db.update(mailEntwuerfe).set({ versandFehler: r.fehler ?? "Unbekannter Fehler" }).where(eq(mailEntwuerfe.id, id));
    return { ok: false, fehler: r.fehler };
  }
  await db.delete(mailEntwuerfe).where(eq(mailEntwuerfe.id, id));
  return { ok: true };
}

/** 15s-Job: fällige Ausgang-Einträge (geplantesSendenAm <= jetzt) versenden. */
export function starteEntwurfQueue(): void {
  setInterval(async () => {
    try {
      const db = getDb();
      const faellig = await db
        .select({ id: mailEntwuerfe.id })
        .from(mailEntwuerfe)
        .where(and(eq(mailEntwuerfe.status, "ausgang"), lte(mailEntwuerfe.geplantesSendenAm, new Date())))
        .limit(10);
      for (const e of faellig) {
        const r = await sendeEntwurf(e.id);
        if (!r.ok) console.error(`[queue] Entwurf #${e.id}: ${r.fehler}`);
      }
    } catch (e) {
      console.error("[queue] Takt-Fehler:", e instanceof Error ? e.message : e);
    }
  }, 15_000);
}
