// ── Papierkorb (v1.21.7): Aufbewahrungsfrist für weich gelöschte Mails/Entwürfe ─
// Ablauf: stichtag = jetzt − papierkorb_tage (Default 14). Mails gehen über den
// Notfall-Pfad (IMAP + lokal), Entwürfe per DB-Delete endgültig weg.
import { and, eq, isNotNull, lt } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { companySettings, mailEntwuerfe, mailMails } from "@db/schema";

export async function papierkorbPurge(): Promise<{ mails: number; entwuerfe: number }> {
  const db = getDb();
  const s = await db.query.companySettings.findFirst({ where: eq(companySettings.id, 1) });
  const tage = Math.max(1, s?.papierkorbTage ?? 14);
  const stichtag = new Date(Date.now() - tage * 86_400_000);

  const alteMails = await db
    .select({ id: mailMails.id })
    .from(mailMails)
    .where(and(isNotNull(mailMails.geloeschtAm), lt(mailMails.geloeschtAm, stichtag)))
    .limit(100);
  let mails = 0;
  for (const m of alteMails) {
    try {
      const { loescheMailNotfall } = await import("../imapDienst");
      const r = await loescheMailNotfall(m.id);
      if (r.ok) mails++;
    } catch { /* beim nächsten Lauf erneut */ }
  }

  const entwuerfeAlt = await db
    .select({ id: mailEntwuerfe.id })
    .from(mailEntwuerfe)
    .where(and(isNotNull(mailEntwuerfe.geloeschtAm), lt(mailEntwuerfe.geloeschtAm, stichtag)))
    .limit(200);
  for (const e of entwuerfeAlt) {
    await db.delete(mailEntwuerfe).where(eq(mailEntwuerfe.id, e.id));
  }

  if (mails > 0 || entwuerfeAlt.length > 0) {
    console.log(`[papierkorb] Aufbewahrungsfrist: ${mails} Mails + ${entwuerfeAlt.length} Entwürfe endgültig gelöscht (>${tage} Tage)`);
  }
  return { mails, entwuerfe: entwuerfeAlt.length };
}

/** Beim Boot + alle 6 h. */
export function startePapierkorbPurge(): void {
  papierkorbPurge().catch((e) => console.error("[papierkorb] Purge-Fehler:", e));
  setInterval(() => {
    papierkorbPurge().catch((e) => console.error("[papierkorb] Purge-Fehler:", e));
  }, 6 * 60 * 60 * 1000);
}
