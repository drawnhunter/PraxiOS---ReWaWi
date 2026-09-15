// ── Kontakt-Extraktion aus Mail-Absendern (serverseitig, DSGVO-stark) ──────
// Liest NUR strukturierte Absender-Metadaten (absender_name/absender_adresse
// aus mail_mails) — KEINE Mail-Inhalte. Datenminimierung per Design: Die
// KI/der Agent orchestriert, ohne Körper zu sehen.
import { eq, sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { kontakte, mailMails } from "@db/schema";

export interface KontaktKandidat {
  email: string;
  name: string;
  quelleMailKonto: string | null;
  bereitsVorhanden: boolean;
  mailAnzahl: number;
}

/** Kandidaten aus Mail-Absendern (dedupliziert, mit Vorhanden-Markierung). */
export async function extrahiereKandidaten(kontoId?: number): Promise<KontaktKandidat[]> {
  const db = getDb();
  const bedingung = kontoId ? eq(mailMails.kontoId, kontoId) : undefined;
  const rows = await db
    .select({
      email: mailMails.absenderAdresse,
      name: mailMails.absenderName,
      anzahl: sql<string>`COUNT(*)`,
    })
    .from(mailMails)
    .where(bedingung)
    .groupBy(mailMails.absenderAdresse, mailMails.absenderName);

  const vorhandene = await db.select({ email: kontakte.email }).from(kontakte);
  const bekannt = new Set(vorhandene.map((k) => k.email.toLowerCase()));

  return rows
    .filter((r) => r.email && r.email.includes("@") && !r.email.startsWith("noreply@") && !r.email.startsWith("no-reply@"))
    .map((r) => ({
      email: r.email!.toLowerCase(),
      name: (r.name ?? r.email!.split("@")[0]).trim(),
      quelleMailKonto: null,
      bereitsVorhanden: bekannt.has(r.email!.toLowerCase()),
      mailAnzahl: Number(r.anzahl),
    }))
    .sort((a, b) => Number(b.mailAnzahl) - Number(a.mailAnzahl));
}

/** Kandidaten uebernehmen (nur neue, dedupliziert via Unique-Index). */
export async function uebernehmeKandidaten(kandidaten: { email: string; name: string; quelleMailKonto?: string | null }[]): Promise<{ neu: number; uebersprungen: number }> {
  const db = getDb();
  let neu = 0;
  let uebersprungen = 0;
  for (const k of kandidaten) {
    const email = k.email.toLowerCase().trim();
    const vorhanden = await db.query.kontakte.findFirst({ where: eq(kontakte.email, email) });
    if (vorhanden) {
      uebersprungen++;
      continue;
    }
    await db.insert(kontakte).values({
      email,
      name: k.name.trim() || email.split("@")[0],
      quelle: "mail",
      erstelltVon: "agent",
    });
    neu++;
  }
  return { neu, uebersprungen };
}
