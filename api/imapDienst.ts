// ── E-Mail-Eingang (IMAP-Abruf) ────────────────────────────────────────────
// Fragt aktive Postfaecher im eigenen Intervall ab und legt PDF-/Bild-Anhaenge
// als Dokumente im Post Manager an. Laeuft nur in Produktion (Start in boot.ts).
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { eq } from "drizzle-orm";
import { getDb } from "./queries/connection";
import { emailKonten } from "@db/schema";
import { entschluesseln } from "./lib/secrets";
import { erzeugePostEingang, mimeAusName } from "./lib/posteingang";

const MAX_MAILS_PRO_LAUF = 20;
const ANHANG_TYPEN = ["application/pdf", "image/jpeg", "image/png", "image/jpg"];

let gestartet = false;

async function rufeKontoAb(konto: typeof emailKonten.$inferSelect): Promise<void> {
  const db = getDb();
  const passwort = entschluesseln(konto.passwortEnc);
  if (!passwort) throw new Error("Passwort konnte nicht entschlüsselt werden.");

  const client = new ImapFlow({
    host: konto.host,
    port: konto.port,
    secure: konto.tls,
    auth: { user: konto.benutzer, pass: passwort },
    logger: false,
    socketTimeout: 30000,
    greetingTimeout: 15000,
  });

  let importiert = 0;
  try {
    await client.connect();
    const lock = await client.getMailboxLock(konto.ordner);
    try {
      const uids = await client.search({ seen: false }, { uid: true });
      const liste = (uids || []).slice(0, MAX_MAILS_PRO_LAUF);
      for (const uid of liste) {
        const nachricht = (await client.fetchOne(uid, { source: true }, { uid: true })) as
          | { source?: Buffer }
          | false;
        if (!nachricht || !nachricht.source) continue;
        const geparst = await simpleParser(nachricht.source);
        const absender = geparst.from?.value?.[0]?.name || geparst.from?.value?.[0]?.address || null;
        let hatteBeleg = false;
        for (const anhang of geparst.attachments ?? []) {
          const name = anhang.filename || "anhang";
          const mime = mimeAusName(name, anhang.contentType);
          if (!ANHANG_TYPEN.includes(mime)) continue;
          await erzeugePostEingang({
            originalname: name,
            mime,
            puffer: anhang.content,
            typ: konto.route,
            quelle: `E-Mail · ${konto.name}`,
            absenderFreitext: absender,
          });
          importiert++;
          hatteBeleg = true;
        }
        // Nur als gelesen markieren, wenn Anhaenge sicher gespeichert sind —
        // so geht bei Fehlern nichts verloren.
        if (hatteBeleg) await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
      }
    } finally {
      lock.release();
    }
    await client.logout();
    await db
      .update(emailKonten)
      .set({ letzterAbruf: new Date(), letzterFehler: null })
      .where(eq(emailKonten.id, konto.id));
    if (importiert > 0) {
      console.log(`[imap] ${konto.name}: ${importiert} Beleg(e) importiert`);
    }
  } catch (e) {
    try {
      await client.logout();
    } catch {
      /* bereits getrennt */
    }
    const fehler = e instanceof Error ? e.message : String(e);
    await db
      .update(emailKonten)
      .set({ letzterAbruf: new Date(), letzterFehler: fehler.slice(0, 500) })
      .where(eq(emailKonten.id, konto.id));
    console.error(`[imap] ${konto.name}: ${fehler}`);
  }
}

/** Verbindungstest aus den Einstellungen heraus. */
export async function testeKonto(id: number): Promise<{ ok: boolean; fehler?: string }> {
  const konto = await getDb().query.emailKonten.findFirst({ where: eq(emailKonten.id, id) });
  if (!konto) throw new Error("Konto nicht gefunden.");
  const passwort = entschluesseln(konto.passwortEnc);
  if (!passwort) return { ok: false, fehler: "Passwort nicht lesbar." };
  const client = new ImapFlow({
    host: konto.host,
    port: konto.port,
    secure: konto.tls,
    auth: { user: konto.benutzer, pass: passwort },
    logger: false,
    socketTimeout: 20000,
    greetingTimeout: 10000,
  });
  try {
    await client.connect();
    const lock = await client.getMailboxLock(konto.ordner);
    lock.release();
    await client.logout();
    return { ok: true };
  } catch (e) {
    try {
      await client.logout();
    } catch {
      /* ok */
    }
    return { ok: false, fehler: e instanceof Error ? e.message.slice(0, 300) : String(e) };
  }
}

/** Intervall-Schleife: jede Minute pruefen, welche Konten faellig sind. */
export function starteImapDienst(): void {
  if (gestartet) return;
  gestartet = true;
  const tick = async () => {
    try {
      const konten = await getDb().select().from(emailKonten).where(eq(emailKonten.aktiv, true));
      const jetzt = Date.now();
      for (const k of konten) {
        const letzter = k.letzterAbruf ? new Date(k.letzterAbruf).getTime() : 0;
        if (jetzt - letzter >= k.intervallMinuten * 60 * 1000) {
          await rufeKontoAb(k);
        }
      }
    } catch (e) {
      console.error("[imap] Tick fehlgeschlagen:", e);
    }
  };
  // erster Lauf nach 15 s, danach minuetlich
  setTimeout(() => {
    void tick();
    setInterval(() => void tick(), 60 * 1000);
  }, 15 * 1000);
  console.log("[imap] E-Mail-Abruf-Dienst gestartet (minuetlicher Takt)");
}
