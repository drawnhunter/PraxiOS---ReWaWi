// Gemeinsamer SMTP-Zugang (Mailversand Belege + Support-Meldungen)
import nodemailer from "nodemailer";
import { eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { companySettings } from "@db/schema";
import { entschluesseln } from "./secrets";

export async function ladeSmtp() {
  const s = await getDb().query.companySettings.findFirst({
    where: eq(companySettings.id, 1),
  });
  if (!s?.smtpHost || !s.smtpUser) {
    throw new Error("SMTP ist noch nicht eingerichtet — bitte unter Einstellungen → E-Mail hinterlegen.");
  }
  const passwort = entschluesseln(s.smtpPasswortEnc);
  // Test-Hook: "stream" als Host erzeugt die Mail ohne Versand (fuer Tests)
  if (s.smtpHost === "stream") {
    return {
      transporter: nodemailer.createTransport({
        streamTransport: true,
        buffer: true,
      } as never),
      absender: s.smtpAbsender || s.smtpUser,
    };
  }
  return {
    transporter: nodemailer.createTransport({
      host: s.smtpHost,
      port: s.smtpPort,
      secure: s.smtpPort === 465,
      auth: passwort ? { user: s.smtpUser, pass: passwort } : undefined,
      requireTLS: s.smtpPort === 587,
    }),
    absender: s.smtpAbsender || s.smtpUser,
  };
}

/** SMTP-Transporter je Mail-Konto (kontobezogen), mit globalem Fallback. */
export async function ladeSmtpKonto(kontoId?: number): Promise<{
  transporter: import("nodemailer").Transporter;
  absender: string;
  kontoName: string;
}> {
  if (!kontoId) {
    const basis = await ladeSmtp();
    return { ...basis, kontoName: "Firmen-SMTP" };
  }
  const { emailKonten } = await import("@db/schema");
  const konto = await getDb().query.emailKonten.findFirst({ where: eq(emailKonten.id, kontoId) });
  if (!konto) throw new Error("Mail-Konto nicht gefunden.");
  if (!konto.smtpHost || !konto.smtpBenutzer || !konto.smtpPasswortEnc) {
    throw new Error(`Konto „${konto.name}" hat keine SMTP-Zugangsdaten (in den Kontoeinstellungen hinterlegen).`);
  }
  const passwort = entschluesseln(konto.smtpPasswortEnc);
  if (!passwort) throw new Error("SMTP-Passwort des Kontos nicht lesbar.");
  return {
    transporter: nodemailer.createTransport({
      host: konto.smtpHost,
      port: konto.smtpPort ?? 587,
      secure: (konto.smtpPort ?? 587) === 465,
      auth: { user: konto.smtpBenutzer, pass: passwort },
    }),
    absender: konto.smtpAbsender ?? konto.smtpBenutzer,
    kontoName: konto.name,
  };
}
