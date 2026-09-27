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

const ANHANG_TYPEN = ["application/pdf", "image/jpeg", "image/png", "image/jpg"];

let gestartet = false;

/** Mail in mail_mails ablegen (idempotent ueber konto/ordner/uid). */
async function speichereMail(
  konto: typeof emailKonten.$inferSelect,
  ordner: string,
  uid: number,
  geparst: Awaited<ReturnType<typeof simpleParser>>,
  umschlagDatum: Date | null = null,
): Promise<{ id: number; istNeu: boolean }> {
  const db = getDb();
  const exakt = await db.query.mailMails.findFirst({
    where: (m, { and: a, eq: e }) =>
      a(e(m.kontoId, konto.id), e(m.ordner, ordner), e(m.uid, uid)),
    columns: { id: true },
  });
  if (exakt) return { id: exakt.id, istNeu: false };
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
      // Datum niemals null: Header-Date → IMAP-Envelope → Jetzt (alte Papierkorb-Mails
      // haben oft keinen lesbaren Date-Header, Zeitreihen brauchen aber einen Wert)
      datum: geparst.date ?? umschlagDatum ?? new Date(),
      textPlain: geparst.text ? geparst.text.slice(0, 4_000_000) : null,
      textHtml: typeof geparst.html === "string" ? geparst.html.slice(0, 4_000_000) : null,
      anhaenge: JSON.stringify(anhaenge),
    })
    .$returningId();
  // Webhook: mail.neu (fire-and-forget; absenderAdresse unmaskiert — Server-intern)
  import("./lib/webhooks").then(({ feuereWebhooks }) =>
    feuereWebhooks("mail.neu", {
      mailId: id,
      kontoId: konto.id,
      ordner,
      betreff: geparst.subject ?? null,
      absenderAdresse: geparst.from?.value?.[0]?.address ?? null,
      datum: (geparst.date ?? umschlagDatum ?? new Date()).toISOString(),
    }),
  ).catch(() => undefined);
  // Abwesenheitsnotiz (v1.20): serverseitig, Frequenz-Limit 1×/4 Tage je Absender
  import("./lib/abwesenheit")
    .then(({ vielleichtAbwesenheitSenden }) => vielleichtAbwesenheitSenden(konto, geparst))
    .catch(() => undefined);
  return { id, istNeu: true };
}

async function rufeKontoAb(konto: typeof emailKonten.$inferSelect, nurOrdner: string | null = null): Promise<void> {
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
      if (nurOrdner && ordner !== nurOrdner) continue; // gezielter Sync (Agent: POST /mails/sync {ordner})
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
    const dbW = getDb();
    const { and: andW, eq: eqW, sql: sqlW } = await import("drizzle-orm");

    // UIDVALIDITY-Wache (#98): Hat der Server die UIDs des Fachs neu vergeben,
    // sind unsere lokalen Zeilen (kontoId+ordner+uid) Kollisionen in spe — Cache
    // dieses Fachs invalidieren und vollständig neu befüllen.
    const mailbox = (await client.mailboxOpen(ordner)) as unknown as { uidValidity?: bigint | number } | undefined;
    const aktuell = mailbox?.uidValidity !== undefined ? Number(mailbox.uidValidity) : null;
    if (aktuell !== null) {
      const karte = konto.uidvaliditaet ? (JSON.parse(konto.uidvaliditaet) as Record<string, number>) : {};
      const bekannt = karte[ordner];
      if (bekannt !== undefined && bekannt !== aktuell) {
        const [geloescht] = await dbW.execute(
          sqlW`DELETE FROM mail_mails WHERE konto_id = ${konto.id} AND ordner = ${ordner}`,
        ) as unknown as [{ affectedRows?: number }, unknown];
        console.warn(
          `[imap] ${konto.name}: UIDVALIDITY ${bekannt} → ${aktuell} in ${ordner} — Cache invalidiert (${geloescht?.affectedRows ?? "?"} Zeilen), Backfill neu`,
        );
      }
      if (bekannt !== aktuell) {
        karte[ordner] = aktuell;
        await dbW.update(emailKonten).set({ uidvaliditaet: JSON.stringify(karte) }).where(eqW(emailKonten.id, konto.id));
      }
    }

    // Lückenloser Backfill per Wasserzeichen: neue Mails (UID > max bekannt) zuerst,
    // dann wandert das Fenster Lauf für Lauf in die Vergangenheit (UID < min bekannt),
    // bis der Ordner komplett ist. Dedup macht Wiederholungen kostenlos.
    const uids: number[] = ((await client.search({}, { uid: true })) as number[] | false) || [];
    const [wm] = await dbW
      .select({
        minUid: sqlW<number | null>`MIN(${mailMails.uid})`,
        maxUid: sqlW<number | null>`MAX(${mailMails.uid})`,
      })
      .from(mailMails)
      .where(andW(eqW(mailMails.kontoId, konto.id), eqW(mailMails.ordner, ordner)));
    const BUDGET = 50;
    let liste: number[];
    if (wm?.minUid == null) {
      liste = [...uids].sort((a, b) => b - a).slice(0, BUDGET); // erster Kontakt: neueste zuerst
    } else {
      const neu = uids.filter((u) => u > (wm.maxUid ?? 0)).sort((a, b) => b - a);
      const aelter = uids
        .filter((u) => u < (wm.minUid as number))
        .sort((a, b) => b - a)
        .slice(0, Math.max(0, BUDGET - neu.length));
      liste = [...neu, ...aelter];
    }
    for (const uid of liste) {
        const nachricht = (await client.fetchOne(uid, { source: true, envelope: true }, { uid: true })) as
          | { source?: Buffer; envelope?: { date?: Date } }
          | false;
        if (!nachricht || !nachricht.source) continue;
        const geparst = await simpleParser(nachricht.source);
        const absender = geparst.from?.value?.[0]?.name || geparst.from?.value?.[0]?.address || null;
        // Mail zuerst ablegen (idempotent) — dann Anhaenge in den Post Manager
        const { id: mailId, istNeu } = await speichereMail(konto, ordner, uid, geparst, nachricht.envelope?.date ?? null);
        if (!istNeu) continue; // bekannt: Mail + Anhaenge schon verarbeitet
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

/** Manueller Sync eines Kontos (UI-Button „Jetzt abrufen"; optional nur ein Ordner). */
export async function synchronisiereKonto(id: number, nurOrdner: string | null = null): Promise<{ ok: boolean; fehler?: string }> {
  const konto = await getDb().query.emailKonten.findFirst({ where: eq(emailKonten.id, id) });
  if (!konto) throw new Error("Konto nicht gefunden.");
  try {
    await rufeKontoAb(konto, nurOrdner);
    const frisch = await getDb().query.emailKonten.findFirst({ where: eq(emailKonten.id, id) });
    return frisch?.letzterFehler ? { ok: false, fehler: frisch.letzterFehler } : { ok: true };
  } catch (e) {
    return { ok: false, fehler: e instanceof Error ? e.message.slice(0, 300) : String(e) };
  }
}

// ── Postfach-Ordner verwalten (Agent: Struktur aufbauen/sortieren) ─────────
const SYSTEM_ORDNER = /^(inbox|gesendet|gesendete objekte|sent|entwürfe|drafts|papierkorb|trash|spam|junk|archiv|archive)$/i;

/** Echte IMAP-Fehlermeldung extrahieren (imapflow: Server-Antwort steckt in response/responseText). */
function besteFehlermeldung(e: unknown): string {
  const x = e as { response?: string; responseText?: string; message?: string } | null;
  const roh = x?.response || x?.responseText || x?.message || String(e);
  return String(roh).replace(/\s+/g, " ").slice(0, 300);
}

/** Modified-UTF-7 (IMAP) → Unicode — für Ordnernamen wie 'Vertr&AOk-ge' → 'Verträge'. */
export function utf7Dekodieren(s: string): string {
  return s.replace(/&([A-Za-z0-9+,]*)-/g, (_m, p1: string) => {
    try {
      const b64 = p1.replace(/,/g, "/");
      const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
      return Buffer.from(padded, "base64").toString("utf16le");
    } catch {
      return _m;
    }
  });
}

/** Name aus der Server-Ordnerliste finden — tolerant gegenüber Trailing-Spaces (Kasserver #94). */
function findeOrdnerName(liste: string[], gesucht: string): string | null {
  const g = gesucht.trim();
  return liste.find((o) => o === gesucht) ?? liste.find((o) => o.trim() === g) ?? null;
}

async function mitKontoClient<T>(
  kontoId: number,
  aktion: (client: ImapFlow, konto: typeof emailKonten.$inferSelect) => Promise<T>,
): Promise<{ ok: boolean; fehler?: string; daten?: T }> {
  const konto = await getDb().query.emailKonten.findFirst({ where: eq(emailKonten.id, kontoId) });
  if (!konto) return { ok: false, fehler: "Konto nicht gefunden." };
  const passwort = entschluesseln(konto.passwortEnc);
  if (!passwort) return { ok: false, fehler: "Passwort nicht lesbar." };
  const client = new ImapFlow({
    host: konto.host, port: konto.port, secure: konto.tls,
    auth: { user: konto.benutzer, pass: passwort },
    logger: false, socketTimeout: 20000, greetingTimeout: 10000,
  });
  try {
    await client.connect();
    const daten = await aktion(client, konto);
    await client.logout();
    return { ok: true, daten };
  } catch (e) {
    try { await client.logout(); } catch { /* ok */ }
    return { ok: false, fehler: besteFehlermeldung(e) };
  }
}

async function ordnerListeAktualisieren(konto: typeof emailKonten.$inferSelect): Promise<string[]> {
  const r = await mitKontoClient(konto.id, async (client) => {
    const boxen = await client.list();
    // mUTF-7 dekodieren, damit Umlaut-Fächer in DB/UI sauber ankommen (#94)
    return boxen.map((b) => (b.path ? utf7Dekodieren(b.path) : b.path)).filter(Boolean);
  });
  if (r.ok && r.daten) {
    await getDb().update(emailKonten).set({ ordnerListe: JSON.stringify(r.daten) }).where(eq(emailKonten.id, konto.id));
    return r.daten;
  }
  return konto.ordnerListe ? (JSON.parse(konto.ordnerListe) as string[]).map(utf7Dekodieren) : [];
}

export async function erstelleOrdner(kontoId: number, name: string): Promise<{ ok: boolean; fehler?: string }> {
  if (!name.trim() || name.length > 120) return { ok: false, fehler: "Ungültiger Ordnername." };
  const r = await mitKontoClient(kontoId, async (client, konto) => {
    await client.mailboxCreate(name.trim());
    await ordnerListeAktualisieren(konto);
  });
  return { ok: r.ok, fehler: r.fehler };
}

export async function benenneOrdnerUm(kontoId: number, alt: string, neu: string): Promise<{ ok: boolean; fehler?: string }> {
  if (SYSTEM_ORDNER.test(alt)) return { ok: false, fehler: `System-Ordner „${alt}" kann nicht umbenannt werden.` };
  if (!neu.trim() || neu.length > 120) return { ok: false, fehler: "Ungültiger neuer Name." };
  const r = await mitKontoClient(kontoId, async (client, konto) => {
    const boxen = (await client.list()).map((b) => (b.path ? utf7Dekodieren(b.path) : b.path)).filter(Boolean);
    const echt = findeOrdnerName(boxen, alt);
    if (!echt) throw new Error(`Ordner „${alt}" existiert auf dem Server nicht (vorhanden: ${boxen.join(", ")})`);
    await client.mailboxRename(echt, neu.trim());
    // Lokale Mails umhängen (auch trailing-space-Varianten), damit nichts „verschwindet"
    const { mailMails } = await import("@db/schema");
    const { and, like } = await import("drizzle-orm");
    await getDb().update(mailMails).set({ ordner: neu.trim() })
      .where(and(eq(mailMails.kontoId, kontoId), like(mailMails.ordner, `${alt.trim()}%`)));
    await ordnerListeAktualisieren(konto);
  });
  return { ok: r.ok, fehler: r.fehler };
}

export async function loescheOrdner(kontoId: number, name: string): Promise<{ ok: boolean; fehler?: string }> {
  if (SYSTEM_ORDNER.test(name)) return { ok: false, fehler: `System-Ordner „${name}" kann nicht gelöscht werden.` };
  const r = await mitKontoClient(kontoId, async (client, konto) => {
    const boxen = (await client.list()).map((b) => (b.path ? utf7Dekodieren(b.path) : b.path)).filter(Boolean);
    const echt = findeOrdnerName(boxen, name);
    if (!echt) throw new Error(`Ordner „${name}" existiert auf dem Server nicht.`);
    // Erst expunge (gelöschte Mails endgültig entfernen), dann löschen (#94: 409 nach Move)
    try {
      const lock = await client.getMailboxLock(echt);
      try { await (client as unknown as { run: (cmd: string) => Promise<unknown> }).run("EXPUNGE"); } finally { lock.release(); }
    } catch { /* nicht jedes Fach erlaubt Expunge — Löschen trotzdem versuchen */ }
    await client.mailboxDelete(echt);
    // Lokale Zeilen des Ordners aufräumen (Mails waren vorher verschoben worden)
    const { mailMails } = await import("@db/schema");
    const { and, like } = await import("drizzle-orm");
    await getDb().delete(mailMails).where(and(eq(mailMails.kontoId, kontoId), like(mailMails.ordner, `${name.trim()}%`)));
    await ordnerListeAktualisieren(konto);
  });
  return { ok: r.ok, fehler: r.fehler };
}

/** Mail per IMAP-MOVE in einen anderen Ordner verschieben (Server bleibt Wahrheit). */
export async function verschiebeMail(
  kontoId: number,
  quellOrdner: string,
  uid: number,
  zielOrdner: string,
): Promise<{ ok: boolean; fehler?: string }> {
  const konto = await getDb().query.emailKonten.findFirst({ where: eq(emailKonten.id, kontoId) });
  if (!konto) return { ok: false, fehler: "Konto nicht gefunden." };
  const passwort = entschluesseln(konto.passwortEnc);
  if (!passwort) return { ok: false, fehler: "Passwort nicht lesbar." };
  const client = new ImapFlow({
    host: konto.host, port: konto.port, secure: konto.tls,
    auth: { user: konto.benutzer, pass: passwort },
    logger: false, socketTimeout: 20000, greetingTimeout: 10000,
  });
  try {
    await client.connect();
    const lock = await client.getMailboxLock(quellOrdner);
    try {
      await client.messageMove(String(uid), zielOrdner, { uid: true });
    } finally {
      lock.release();
    }
    await client.logout();
    return { ok: true };
  } catch (e) {
    try { await client.logout(); } catch { /* ok */ }
    return { ok: false, fehler: e instanceof Error ? e.message.slice(0, 300) : String(e) };
  }
}

/**
 * Datum-Heilung: Mails ohne Datum (alte Papierkorb-Reste ohne Date-Header)
 * bekommen ihr Datum aus dem IMAP-Envelope nachgepflegt. Fallback: created_at.
 */
export async function heileMailDaten(): Promise<{ geprueft: number; geheilt: number; fehler: string[] }> {
  const db = getDb();
  const { isNull, asc } = await import("drizzle-orm");
  const offene = await db
    .select()
    .from(mailMails)
    .where(isNull(mailMails.datum))
    .orderBy(asc(mailMails.kontoId));
  const ergebnis = { geprueft: offene.length, geheilt: 0, fehler: [] as string[] };
  if (offene.length === 0) return ergebnis;

  // Je Konto einmal verbinden, dann alle betroffenen UIDs per Envelope lesen
  const jeKonto = new Map<number, typeof offene>();
  for (const m of offene) {
    const liste = jeKonto.get(m.kontoId) ?? [];
    liste.push(m);
    jeKonto.set(m.kontoId, liste);
  }
  for (const [kontoId, mails] of jeKonto) {
    const konto = await db.query.emailKonten.findFirst({ where: eq(emailKonten.id, kontoId) });
    const passwort = konto ? entschluesseln(konto.passwortEnc) : null;
    if (!konto || !passwort) {
      ergebnis.fehler.push(`Konto #${kontoId}: nicht lesbar — Fallback created_at`);
      await fallbackCreatedAt(mails);
      ergebnis.geheilt += mails.length;
      continue;
    }
    const client = new ImapFlow({
      host: konto.host, port: konto.port, secure: konto.tls,
      auth: { user: konto.benutzer, pass: passwort },
      logger: false, socketTimeout: 20000, greetingTimeout: 10000,
    });
    try {
      await client.connect();
      let ordnerAktuell: string | null = null;
      let lock: Awaited<ReturnType<typeof client.getMailboxLock>> | null = null;
      for (const m of mails) {
        try {
          if (ordnerAktuell !== m.ordner) {
            lock?.release();
            lock = await client.getMailboxLock(m.ordner);
            ordnerAktuell = m.ordner;
          }
          const n = (await client.fetchOne(m.uid, { envelope: true }, { uid: true })) as
            | { envelope?: { date?: Date } }
            | false;
          const datum = n && n.envelope?.date ? n.envelope.date : m.createdAt;
          await db.update(mailMails).set({ datum }).where(eq(mailMails.id, m.id));
          ergebnis.geheilt++;
        } catch (e) {
          ergebnis.fehler.push(`Mail #${m.id}: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}`);
          await db.update(mailMails).set({ datum: m.createdAt }).where(eq(mailMails.id, m.id));
          ergebnis.geheilt++;
        }
      }
      lock?.release();
      await client.logout();
    } catch (e) {
      ergebnis.fehler.push(`Konto #${kontoId}: ${e instanceof Error ? e.message.slice(0, 200) : String(e)} — Fallback created_at`);
      await fallbackCreatedAt(mails);
      ergebnis.geheilt += mails.length;
    }
  }
  return ergebnis;

  async function fallbackCreatedAt(mails: typeof offene): Promise<void> {
    for (const m of mails) {
      await db.update(mailMails).set({ datum: m.createdAt }).where(eq(mailMails.id, m.id));
    }
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
