// ── E-Mail-Eingang (IMAP-Abruf) ────────────────────────────────────────────
// Fragt aktive Postfaecher im eigenen Intervall ab und legt PDF-/Bild-Anhaenge
// als Dokumente im Post Manager an. Laeuft nur in Produktion (Start in boot.ts).
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { eq } from "drizzle-orm";
import { getDb } from "./queries/connection";
import { emailKonten, mailMails, postEingang } from "@db/schema";
import { entschluesseln } from "./lib/secrets";
import { erzeugePostEingang, mimeAusName } from "./lib/posteingang";

const MAX_MAILS_PRO_LAUF = 20;
const ANHANG_TYPEN = ["application/pdf", "image/jpeg", "image/png", "image/jpg"];

let gestartet = false;

/** Mail in mail_mails ablegen (idempotent ueber konto/ordner/uid). */
async function speichereMail(
  konto: typeof emailKonten.$inferSelect,
  ordner: string,
  uid: number,
  geparst: Awaited<ReturnType<typeof simpleParser>>,
): Promise<number> {
  const db = getDb();
  const exakt = await db.query.mailMails.findFirst({
    where: (m, { and: a, eq: e }) =>
      a(e(m.kontoId, konto.id), e(m.ordner, ordner), e(m.uid, uid)),
    columns: { id: true },
  });
  if (exakt) return exakt.id;
  const anhaenge = (geparst.attachments ?? []).map((a) => ({
    name: a.filename || "anhang",
    mime: mimeAusName(a.filename || "anhang", a.contentType),
    groesse: a.size ?? a.content?.length ?? 0,
    postEingangId: null as number | null,
  }));
  const [{ id }] = await db
    .insert(mailMails)
    .values({
      kontoId: konto.id,
      ordner,
      uid,
      messageId: geparst.messageId ?? null,
      betreff: geparst.subject ?? null,
      absenderName: geparst.from?.value?.[0]?.name ?? null,
      absenderAdresse: geparst.from?.value?.[0]?.address ?? null,
      empfaenger: (() => {
        const t = geparst.to;
        if (!t) return null;
        const arr = Array.isArray(t) ? t : [t];
        return arr
          .flatMap((x) => x.value ?? [])
          .map((v) => (v.name ? `${v.name} <${v.address}>` : v.address ?? ""))
          .filter(Boolean)
          .join(", ") || null;
      })(),
      datum: geparst.date ?? null,
      textPlain: geparst.text ? geparst.text.slice(0, 4_000_000) : null,
      textHtml: typeof geparst.html === "string" ? geparst.html.slice(0, 4_000_000) : null,
      anhaenge: JSON.stringify(anhaenge),
    })
    .$returningId();
  return id;
}

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

    // Fächer entdecken (beim ersten Sync) und speichern — danach alle synchronisieren
    let ordnerListe: string[] = [];
    try {
      const vorhandene = konto.ordnerListe ? (JSON.parse(konto.ordnerListe) as string[]) : [];
      ordnerListe = vorhandene;
    } catch { /* neu entdecken */ }
    if (ordnerListe.length === 0) {
      const boxen = await client.list();
      ordnerListe = boxen.map((b) => b.path).filter(Boolean);
      if (ordnerListe.length === 0) ordnerListe = [konto.ordner];
      await db
        .update(emailKonten)
        .set({ ordnerListe: JSON.stringify(ordnerListe) })
        .where(eq(emailKonten.id, konto.id));
      console.log(`[imap] ${konto.name}: ${ordnerListe.length} Fächer entdeckt (${ordnerListe.join(", ")})`);
    }

    for (const ordner of ordnerListe) {
      await rufeOrdnerAb(client, konto, ordner, (n) => { importiert += n; });
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

/** Einzelnen Ordner eines Kontos abrufen (unseen-Mails verarbeiten). */
async function rufeOrdnerAb(
  client: ImapFlow,
  konto: typeof emailKonten.$inferSelect,
  ordner: string,
  zaehle: (n: number) => void,
): Promise<void> {
  let importiert = 0;
  const lock = await client.getMailboxLock(ordner);
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
        // Mail zuerst ablegen (idempotent) — dann Anhaenge in den Post Manager
        const mailId = await speichereMail(konto, ordner, uid, geparst);
        // Auto-Routing-Regeln anwenden (Absender/Betreff-Muster → Typ + Kategorie)
        const db0 = getDb();
        const { mailRegeln } = await import("@db/schema");
        const regeln = await db0.select().from(mailRegeln).where(eq(mailRegeln.aktiv, true));
        let route = konto.route as "rechnung" | "sonstiges";
        let regelKategorie: number | null = null;
        const treffer = regeln
          .sort((a, b) => a.prio - b.prio)
          .find((r) => {
            const text = (r.feld === "betreff" ? geparst.subject ?? "" : absender ?? "").toLowerCase();
            try {
              return new RegExp(r.pattern, "i").test(text);
            } catch {
              return text.includes(r.pattern.toLowerCase());
            }
          });
        if (treffer) {
          route = treffer.postTyp;
          regelKategorie = treffer.kategorieId;
        }

        let hatteBeleg = false;
        const postIds: number[] = [];
        for (const anhang of geparst.attachments ?? []) {
          const name = anhang.filename || "anhang";
          const mime = mimeAusName(name, anhang.contentType);
          if (!ANHANG_TYPEN.includes(mime)) continue;
          const postId = await erzeugePostEingang({
            originalname: name,
            mime,
            puffer: anhang.content,
            typ: route,
            quelle: `E-Mail · ${konto.name}`,
            absenderFreitext: absender,
          });
          if (regelKategorie) {
            try {
              await db0.update(postEingang).set({ kategorieId: regelKategorie }).where(eq(postEingang.id, postId));
            } catch { /* Kategorie-Spalte optional */ }
          }
          postIds.push(postId);
          importiert++;
          hatteBeleg = true;
        }
        // Anhang-Metadaten mit Post-Manager-Verknuepfung nachziehen
        if (postIds.length > 0) {
          const db = getDb();
          const mail = await db.query.mailMails.findFirst({ where: eq(mailMails.id, mailId) });
          if (mail?.anhaenge) {
            try {
              const meta = JSON.parse(mail.anhaenge) as { name: string; mime: string; postEingangId: number | null }[];
              let i = 0;
              for (const m of meta) {
                if (ANHANG_TYPEN.includes(m.mime) && i < postIds.length) {
                  m.postEingangId = postIds[i++];
                }
              }
              await db.update(mailMails).set({ anhaenge: JSON.stringify(meta) }).where(eq(mailMails.id, mailId));
            } catch { /* Metadaten sind Best-Effort */ }
          }
        }
        // Nur als gelesen markieren, wenn Anhaenge sicher gespeichert sind —
        // so geht bei Fehlern nichts verloren.
        if (hatteBeleg) await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
      }
    } finally {
      lock.release();
    }
    zaehle(importiert);
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

/** Manueller Sync eines Kontos (UI-Button „Jetzt abrufen"). */
export async function synchronisiereKonto(id: number): Promise<{ ok: boolean; fehler?: string }> {
  const konto = await getDb().query.emailKonten.findFirst({ where: eq(emailKonten.id, id) });
  if (!konto) throw new Error("Konto nicht gefunden.");
  try {
    await rufeKontoAb(konto);
    const frisch = await getDb().query.emailKonten.findFirst({ where: eq(emailKonten.id, id) });
    return frisch?.letzterFehler ? { ok: false, fehler: frisch.letzterFehler } : { ok: true };
  } catch (e) {
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
