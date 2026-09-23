// ── Abwesenheitsnotiz (v1.20): serverseitiger Auto-Reply ────────────────────
// Gmail/Outlook-Modell: Zeitraum von–bis, 1× je Absender in 4 Tagen,
// Newsletter/noreply/Listen nie beantworten, optional nur bekannte Kontakte.
import { eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { emailKonten, mailAutoreplyLog } from "@db/schema";
import type { simpleParser } from "mailparser";

type Konto = typeof emailKonten.$inferSelect;
type Geparst = Awaited<ReturnType<typeof simpleParser>>;

const AUSGESCHLOSSEN = /noreply|no-reply|newsletter|mailer-daemon|notifications@|donotreply/i;

/** Sendet ggf. eine Abwesenheitsnotiz (alle Bedingungen geprüft). Feuer-und-vergessen-sicher. */
export async function vielleichtAbwesenheitSenden(konto: Konto, geparst: Geparst): Promise<void> {
  if (!konto.abwesenheitAktiv || !konto.abwesenheitText?.trim()) return;
  const heute = new Date().toISOString().slice(0, 10);
  if (konto.abwesenheitVon && heute < konto.abwesenheitVon) return;
  if (konto.abwesenheitBis && heute > konto.abwesenheitBis) return;

  const absender = geparst.from?.value?.[0]?.address?.toLowerCase();
  const betreff = geparst.subject ?? "";
  if (!absender || AUSGESCHLOSSEN.test(absender)) return;
  // Automatische Antworten nie beantworten (Loop-Schutz) — weder unser eigener Responder noch andere
  if (gepardstHeadersSagenAutomatisch(geparst)) return;

  const db = getDb();
  // Nur-Kontakte-Option: Absender muss in der Kartei sein
  if (konto.abwesenheitNurKontakte) {
    const { kontakte } = await import("@db/schema");
    const treffer = await db.query.kontakte.findFirst({ where: eq(kontakte.email, absender) });
    if (!treffer) return;
  }
  // Frequenz-Limit: 1× je Absender in 4 Tagen (Gmail-Modell)
  const { and, gte } = await import("drizzle-orm");
  const vierTage = new Date(Date.now() - 4 * 86400000);
  const zuletzt = await db
    .select({ gesendetAm: mailAutoreplyLog.gesendetAm })
    .from(mailAutoreplyLog)
    .where(and(eq(mailAutoreplyLog.kontoId, konto.id), eq(mailAutoreplyLog.absender, absender), gte(mailAutoreplyLog.gesendetAm, vierTage)))
    .limit(1);
  if (zuletzt.length > 0) return;

  const { versendeMail } = await import("./mailVersand");
  const r = await versendeMail({
    kontoId: konto.id,
    empfaenger: [absender],
    betreff: `Abwesenheitsnotiz: Re: ${betreff}`.slice(0, 200),
    text: konto.abwesenheitText.trim(),
    mitSignatur: false,
  });
  if (r.ok) {
    await db.insert(mailAutoreplyLog).values({ kontoId: konto.id, absender }).catch(() => undefined);
  }
}

function gepardstHeadersSagenAutomatisch(geparst: Geparst): boolean {
  const auto = geparst.headers.get("auto-submitted");
  if (auto && String(auto).toLowerCase() !== "no") return true;
  const prece = geparst.headers.get("precedence");
  if (prece && /bulk|list|junk/i.test(String(prece))) return true;
  if (geparst.headers.get("list-unsubscribe") || geparst.headers.get("list-id")) return true; // Listen/Newsletter
  return false;
}
