// ── Geteilter Mail-Versand (Postfach + Agent-API) ──────────────────────────
import { ladeSmtp } from "./smtp";
import { getDb } from "../queries/connection";
import { mailLog } from "@db/schema";
import { ladeFirmaLive } from "../pdfBelege";

export interface VersandEingabe {
  empfaenger: string[]; // E-Mail-Adressen
  cc?: string[];
  betreff: string;
  text: string;
  anhaenge?: { dateiname: string; base64: string; mime: string }[];
  inReplyTo?: string | null;
  references?: string | null;
  mitSignatur?: boolean;
}

/** Sendet eine Mail ueber das Firmen-SMTP-Konto (Signatur optional). */
export async function versendeMail(e: VersandEingabe): Promise<{ ok: boolean; fehler?: string }> {
  const { transporter, absender } = await ladeSmtp();
  const firma = await ladeFirmaLive();
  const settings = await getDb().query.companySettings.findFirst();
  const signatur = e.mitSignatur !== false && settings?.signatur ? `\n\n${settings.signatur}` : "";
  const text = `${e.text}${signatur}`;

  const empfaengerListe = e.empfaenger.map((x) => x.trim()).filter(Boolean);
  if (empfaengerListe.length === 0) return { ok: false, fehler: "Kein Empfänger angegeben." };

  let ok = true;
  let fehler: string | undefined;
  try {
    await transporter.sendMail({
      from: `"${absender}" <${firma.email ?? absender}>`,
      to: empfaengerListe.join(", "),
      cc: e.cc?.map((x) => x.trim()).filter(Boolean).join(", ") || undefined,
      subject: e.betreff,
      text,
      inReplyTo: e.inReplyTo ?? undefined,
      references: e.references ?? undefined,
      attachments: (e.anhaenge ?? []).map((a) => ({
        filename: a.dateiname,
        content: Buffer.from(a.base64, "base64"),
        contentType: a.mime,
      })),
    });
  } catch (err) {
    ok = false;
    fehler = err instanceof Error ? err.message : String(err);
  }

  await getDb().insert(mailLog).values({
    belegArt: "mail",
    belegId: 0,
    empfaenger: empfaengerListe.join(", "),
    betreff: e.betreff,
    erfolg: ok,
    fehler: fehler ?? null,
  });

  return { ok, fehler };
}
