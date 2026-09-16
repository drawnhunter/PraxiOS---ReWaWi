// ── Geteilter Mail-Versand (Postfach + Agent-API) ──────────────────────────
import { getDb } from "../queries/connection";
import { mailLog } from "@db/schema";
import { ladeFirmaLive } from "../pdfBelege";

export interface VersandEingabe {
  empfaenger: string[]; // E-Mail-Adressen
  cc?: string[];
  bcc?: string[];
  /** HTML-Inhalt (wenn gesetzt: multipart text+html, text wird als Plain-Version generiert) */
  html?: string;
  betreff: string;
  text: string;
  anhaenge?: { dateiname: string; base64: string; mime: string }[];
  inReplyTo?: string | null;
  references?: string | null;
  mitSignatur?: boolean;
}

/** Sendet eine Mail — kontobezogen (kontoId) oder Firmen-SMTP (Signatur optional). */
export async function versendeMail(e: VersandEingabe & { kontoId?: number }): Promise<{ ok: boolean; fehler?: string }> {
  const { ladeSmtpKonto } = await import("./smtp");
  const { transporter, absender, kontoName } = await ladeSmtpKonto(e.kontoId);
  const firma = await ladeFirmaLive();
  const settings = await getDb().query.companySettings.findFirst();
  const signatur = e.mitSignatur !== false && settings?.signatur ? `\n\n${settings.signatur}` : "";
  const text = `${e.text}${signatur}`;
  const htmlBody = e.html
    ? `${e.html}${signatur ? `<p style="color:#6b7280">${signatur.replace(/\n/g, "<br>")}</p>` : ""}`
    : undefined;

  const empfaengerListe = e.empfaenger.map((x) => x.trim()).filter(Boolean);
  if (empfaengerListe.length === 0) return { ok: false, fehler: "Kein Empfänger angegeben." };

  const mailDaten = {
    from: `"${absender}" <${firma.email ?? absender}>`,
    to: empfaengerListe.join(", "),
    cc: e.cc?.map((x) => x.trim()).filter(Boolean).join(", ") || undefined,
    bcc: e.bcc?.map((x) => x.trim()).filter(Boolean).join(", ") || undefined,
    subject: e.betreff,
    text,
    html: htmlBody,
    inReplyTo: e.inReplyTo ?? undefined,
    references: e.references ?? undefined,
    attachments: (e.anhaenge ?? []).map((a) => ({
      filename: a.dateiname,
      content: Buffer.from(a.base64, "base64"),
      contentType: a.mime,
    })),
  };

  let ok = true;
  let fehler: string | undefined;
  let messageId: string | undefined;
  try {
    const gesendet = await transporter.sendMail(mailDaten);
    messageId = gesendet.messageId;
  } catch (err) {
    ok = false;
    fehler = err instanceof Error ? err.message : String(err);
  }

  // Gesendet-Ablage: per IMAP in den Gesendet-Ordner des Kontos appenden
  // (viele Provider machen das NICHT selbst — sonst bleibt „Gesendet" leer)
  if (ok && e.kontoId) {
    try {
      await legeInGesendetAb(e.kontoId, mailDaten, messageId, e.anhaenge ?? []);
    } catch (err) {
      console.error(`[mail] Gesendet-Ablage fehlgeschlagen (Mail ist raus, nur die Ablage nicht): ${err instanceof Error ? err.message : err}`);
    }
  }

  await getDb().insert(mailLog).values({
    belegArt: "mail",
    belegId: 0,
    empfaenger: `${kontoName} → ${empfaengerListe.join(", ")}`,
    betreff: e.betreff,
    erfolg: ok,
    fehler: fehler ?? null,
  });

  return { ok, fehler };
}

/** MIME-Rohmessage bauen (nodemailer MailComposer steckt in der Dependency). */
async function baueRoheNachricht(daten: Record<string, unknown>): Promise<Buffer> {
  const MailComposer = (await import("nodemailer/lib/mail-composer/index.js")).default;
  const mail = new MailComposer(daten as ConstructorParameters<typeof MailComposer>[0]);
  return new Promise<Buffer>((resolve, reject) => {
    mail.compile().build((err: Error | null, message: Buffer) => (err ? reject(err) : resolve(message)));
  });
}

/**
 * Gesendete Mail in den IMAP-Gesendet-Ordner appenden + lokal sofort sichtbar machen.
 * UID kommt vom Server (UIDPLUS); ohne UID übernimmt der nächste Wasserzeichen-Sync.
 */
async function legeInGesendetAb(
  kontoId: number,
  mailDaten: Record<string, unknown>,
  messageId: string | undefined,
  anhaenge: { dateiname: string; base64: string; mime: string }[],
): Promise<void> {
  const { emailKonten, mailMails } = await import("@db/schema");
  const { eq } = await import("drizzle-orm");
  const { ImapFlow } = await import("imapflow");
  const { entschluesseln } = await import("./secrets");
  const db = getDb();
  const konto = await db.query.emailKonten.findFirst({ where: eq(emailKonten.id, kontoId) });
  if (!konto) return;
  const passwort = entschluesseln(konto.passwortEnc);
  if (!passwort) return;

  // Gesendet-Ordner finden (Bekannte aus ordner_liste, sonst übliche Namen)
  const liste: string[] = konto.ordnerListe ? (JSON.parse(konto.ordnerListe) as string[]) : [];
  const treffer =
    liste.find((o) => /^gesendet$/i.test(o)) ??
    liste.find((o) => /gesendet|sent/i.test(o)) ??
    liste.find((o) => /gesendete objekte/i.test(o)) ??
    "Sent";

  const roh = await baueRoheNachricht(mailDaten);
  const client = new ImapFlow({
    host: konto.host, port: konto.port, secure: konto.tls,
    auth: { user: konto.benutzer, pass: passwort },
    logger: false, socketTimeout: 25000, greetingTimeout: 12000,
  });
  let uid: number | null = null;
  try {
    await client.connect();
    const res = await client.append(treffer, roh, ["\\Seen"]);
    uid = res && typeof res === "object" && "uid" in res ? (res.uid as number) : null;
    await client.logout();
  } catch (e) {
    try { await client.logout(); } catch { /* ok */ }
    throw e;
  }

  // Sofort lokal sichtbar (nur mit echter UID — der Sync dedupt darüber sauber)
  if (uid) {
    await db.insert(mailMails).values({
      kontoId,
      ordner: treffer,
      uid,
      messageId: messageId ?? null,
      betreff: String(mailDaten.subject ?? ""),
      absenderName: null,
      absenderAdresse: null, // eigenes Konto — Anzeige nutzt kontoName im UI
      empfaenger: String(mailDaten.to ?? ""),
      datum: new Date(),
      textPlain: String(mailDaten.text ?? "").slice(0, 4_000_000),
      textHtml: typeof mailDaten.html === "string" ? mailDaten.html.slice(0, 4_000_000) : null,
      anhaenge: JSON.stringify(anhaenge.map((a) => ({ name: a.dateiname, mime: a.mime, groesse: a.base64.length, postEingangId: null }))),
      gelesen: true,
    }).catch(() => undefined); // Kollision (UID doch schon da) → Sync regelt
  }
}
