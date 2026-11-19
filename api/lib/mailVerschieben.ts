// ── Lokaler Ordner-Move mit Kollisions-Heilung (v1.21.11, Bus #197) ─────────
// Hintergrund: mail_eindeutig (konto_id, ordner, uid) verletzt den Move, wenn im
// Zielordner schon eine Zeile mit derselben UID liegt (früherer Move, Import-
// Duplikat, UIDVALIDITY-Relikt). Bisher: ungefangene DB-Exception = HTTP 500.
// UIDs sind serverseitig je Ordner eindeutig — eine Kollision ist also immer ein
// lokales Duplikat und darf zusammengeführt statt abgelehnt werden.
import { and, eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { mailMails } from "@db/schema";

export async function verschiebeMailLokal(
  m: typeof mailMails.$inferSelect,
  ziel: string,
): Promise<{ ok: boolean; zusammengefuehrt?: boolean; fehler?: string }> {
  const db = getDb();
  try {
    const kollision = await db.query.mailMails.findFirst({
      where: and(eq(mailMails.kontoId, m.kontoId), eq(mailMails.ordner, ziel), eq(mailMails.uid, m.uid)),
    });
    if (kollision && kollision.id !== m.id) {
      // Zielzeile mit fehlendem Inhalt aus der Quellzeile anreichern, dann Quelle weg
      await db
        .update(mailMails)
        .set({
          textPlain: kollision.textPlain ?? m.textPlain,
          textHtml: kollision.textHtml ?? m.textHtml,
          anhaenge: kollision.anhaenge ?? m.anhaenge,
          datum: kollision.datum ?? m.datum,
          betreff: kollision.betreff ?? m.betreff,
          messageId: kollision.messageId ?? m.messageId,
          geloeschtAm: kollision.geloeschtAm ?? m.geloeschtAm,
        })
        .where(eq(mailMails.id, kollision.id));
      await db.delete(mailMails).where(eq(mailMails.id, m.id));
      return { ok: true, zusammengefuehrt: true };
    }
    await db.update(mailMails).set({ ordner: ziel }).where(eq(mailMails.id, m.id));
    return { ok: true };
  } catch (e) {
    return { ok: false, fehler: e instanceof Error ? e.message.slice(0, 300) : String(e) };
  }
}
