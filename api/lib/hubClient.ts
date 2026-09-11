// ── PraxiOS: Hub-Client (Pull-Modell, Auftrag Bus #18) ─────────────────────
// Die App meldet sich periodisch beim SupportHub und holt Befehle ab —
// NUR wenn ein Support-Schlüssel verbunden ist. Bei Hub-Ausfall: still weiter.
// Grenzen (verbindlich): keine Shell/kein Dateizugriff außerhalb der App,
// keine Buchhaltungs-/Kundendaten zum Hub — nur Metadaten.
//
// Lernkurve aus dem PaWaWi-Bau (Bus #18, letzter Kommentar) eingearbeitet:
//  - zod-optional ≠ null: optionale Felder werden WEGGELASSEN, nicht null
//  - Feldnamen exakt aus der Hub-Spec (payload / erfolg / details / groesseMb)
//  - Logging pro Takt + manueller Takt-Endpunkt (supportRouter.hubTaktJetzt)
import { execFile } from "child_process";
import { promisify } from "util";
import { mkdirSync } from "fs";
import path from "path";
import { createGzip } from "zlib";
import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { eq, gte, sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { companySettings, supportMeldungen } from "@db/schema";
import { APP_VERSION } from "./version";

const execFileP = promisify(execFile);
const HUB_URL = (process.env.SUPPORT_HUB_URL || "https://support.praxios.dynv6.net").replace(/\/$/, "");
const PRODUKT = process.env.SUPPORT_PRODUKT || "ReWaWi";
const INTERVALL_MS = 10 * 60 * 1000; // alle ~10 min
const BACKUP_DIR = process.env.BACKUP_DIR || "/app/backups";

interface HubAntwort {
  ok: boolean;
  fehler?: string;
}
interface HubBefehl {
  id: number;
  typ: string; // "backup" | "update-hinweis" | "diagnose" | "ping"
  payload?: string | null;
}

async function hubAufruf<T>(pfad: string, init?: RequestInit): Promise<T | null> {
  const res = await fetch(HUB_URL + "/api/hub" + pfad, {
    ...init,
    signal: AbortSignal.timeout(8000),
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const daten = (await res.json()) as T & { ok?: boolean };
  if (typeof daten?.ok !== "boolean") return null;
  return daten;
}

async function ladeSchluessel(): Promise<string | null> {
  const s = await getDb().query.companySettings.findFirst({
    where: eq(companySettings.id, 1),
    columns: { supportSchluessel: true },
  });
  return s?.supportSchluessel ?? null;
}

/** Festplatten-Auslastung in % (df auf /, Bordmittel). */
async function diskProzent(): Promise<number | null> {
  try {
    const { stdout } = await execFileP("df", ["-P", "/"], { timeout: 5000 });
    const zeile = stdout.trim().split("\n").pop() ?? "";
    const m = /(\d+)%/.exec(zeile);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

async function fehler24h(): Promise<number> {
  const seit = new Date(Date.now() - 24 * 3600 * 1000);
  const rows = await getDb().query.supportMeldungen.findMany({
    where: gte(supportMeldungen.createdAt, seit),
    columns: { id: true, status: true },
  });
  return rows.filter((r) => r.status === "fehlgeschlagen").length;
}

/** Größe der neuesten Backup-Datei im Backups-Ordner (MB, 1 Dezimale). */
async function neuesteBackupGroesseMb(): Promise<number | null> {
  try {
    const { readdirSync, statSync } = await import("fs");
    const dateien = readdirSync(BACKUP_DIR)
      .filter((d) => d.endsWith(".sql.gz"))
      .map((d) => ({ d, m: statSync(path.join(BACKUP_DIR, d)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    if (dateien.length === 0) return null;
    const { size } = statSync(path.join(BACKUP_DIR, dateien[0].d));
    return Math.round((size / 1024 / 1024) * 10) / 10;
  } catch {
    return null;
  }
}

// ── Heartbeat-Payload (rein/testbar): optionale Felder WEGGLASSEN ──────────
export function baueHeartbeat(e: {
  schluessel: string;
  diskProzent: number | null;
  uptimeSek: number;
  letztesBackup: string | null; // ISO
  backupGroesseMb: number | null;
  fehler24h: number;
}): Record<string, unknown> {
  return {
    schluessel: e.schluessel,
    produkt: PRODUKT,
    version: APP_VERSION,
    status: "ok",
    diskProzent: e.diskProzent,
    uptimeSek: e.uptimeSek,
    fehler24h: e.fehler24h,
    // Hub-zod: optional heißt weglassen, nicht null (Falle aus dem PaWaWi-Bau)
    ...(e.letztesBackup ? { letztesBackup: e.letztesBackup } : {}),
    ...(e.backupGroesseMb !== null ? { backupGroesseMb: e.backupGroesseMb } : {}),
  };
}

// ── Befehl: backup ─────────────────────────────────────────────────────────
// Eigener SQL-Dump über die App-DB-Verbindung, gzipped ins Backups-Verzeichnis
// (ReWaWi hat alle Belege in der DB — der Dump ist damit vollständig, GoBD).
async function backupAusfuehren(): Promise<{ ok: boolean; detail: string; groesseMb?: number }> {
  const db = getDb();
  mkdirSync(BACKUP_DIR, { recursive: true });
  const stempel = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const ziel = path.join(BACKUP_DIR, `${PRODUKT.replace(/\s/g, "")}-backup-${stempel}.sql.gz`);

  const [tabellen] = (await db.execute(sql`SHOW TABLES`)) as unknown as [
    Record<string, string>[],
    unknown,
  ];

  const datei = createWriteStream(ziel);
  const gzip = createGzip();
  const strom = pipeline(gzip, datei);

  gzip.write(`-- ${PRODUKT} DB-Backup (Hub-Befehl) · ${new Date().toISOString()}\n\n`);
  for (const t of tabellen) {
    const name = Object.values(t)[0];
    gzip.write(`\n-- Tabelle: ${name}\n`);
    const [zeilen] = (await db.execute(
      sql.raw(`SELECT * FROM \`${name}\``),
    )) as unknown as [Record<string, unknown>[], unknown];
    for (const z of zeilen) {
      const spalten = Object.keys(z).map((k) => `\`${k}\``).join(", ");
      const werte = Object.values(z)
        .map((v) => {
          if (v === null) return "NULL";
          if (typeof v === "number" || typeof v === "bigint") return String(v);
          if (v instanceof Date) return `'${v.toISOString().slice(0, 19).replace("T", " ")}'`;
          return `'${String(v).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
        })
        .join(", ");
      gzip.write(`INSERT INTO \`${name}\` (${spalten}) VALUES (${werte});\n`);
    }
  }
  gzip.end();
  await strom;

  const { stat } = await import("fs/promises");
  const { size } = await stat(ziel);
  const groesseMb = Math.round((size / 1024 / 1024) * 10) / 10;

  // Frische-Stempel setzen (Heartbeat meldet ihn ab jetzt)
  await db
    .update(companySettings)
    .set({ backupZuletztAm: new Date() })
    .where(eq(companySettings.id, 1));

  return {
    ok: true,
    detail: `DB-Dump erstellt: ${path.basename(ziel)} (${Math.round(size / 1024)} KB) im Backups-Ordner (${BACKUP_DIR}).`,
    groesseMb,
  };
}

// ── Befehl: diagnose (Premium) ─────────────────────────────────────────────
async function diagnoseAusfuehren(): Promise<{ ok: boolean; detail: string }> {
  return {
    ok: true,
    detail: JSON.stringify({
      produkt: PRODUKT,
      version: APP_VERSION,
      zeit: new Date().toISOString(),
      uptimeSek: Math.round(process.uptime()),
      diskProzent: await diskProzent(),
      fehler24h: await fehler24h(),
      node: process.version,
    }),
  };
}

// ── Befehl: update-hinweis ─────────────────────────────────────────────────
// Lokal als Support-Meldung registriert (sichtbar im Support-Dialog des
// Kunden — Telemetrie-Einsehbarkeit laut Konzept).
async function updateHinweisAusfuehren(inhalt?: string | null): Promise<{ ok: boolean; detail: string }> {
  await getDb().insert(supportMeldungen).values({
    typ: "problem",
    betreff: "Update-Hinweis vom SupportHub",
    nachricht: inhalt?.trim() || "Ein Update ist verfügbar — bitte über den SupportHub bereitstellen.",
    benutzer: "system",
    instanz: PRODUKT,
    version: APP_VERSION,
    status: "gesendet",
  });
  return { ok: true, detail: "Update-Hinweis lokal registriert." };
}

/** Ein Hub-Takt: Schlüssel → heartbeat → befehle → ausführen → ergebnis. */
export async function hubZyklus(): Promise<void> {
  try {
    const schluessel = await ladeSchluessel();
    if (!schluessel) {
      console.log("[hub] Takt: kein Support-Schlüssel verbunden — übersprungen");
      return;
    }

    const s = await getDb().query.companySettings.findFirst({
      where: eq(companySettings.id, 1),
      columns: { backupZuletztAm: true },
    });
    const heartbeat = baueHeartbeat({
      schluessel,
      diskProzent: await diskProzent(),
      uptimeSek: Math.round(process.uptime()),
      letztesBackup: s?.backupZuletztAm?.toISOString() ?? null,
      backupGroesseMb: await neuesteBackupGroesseMb(),
      fehler24h: await fehler24h(),
    });
    const hb = await hubAufruf<HubAntwort>("/heartbeat", {
      method: "POST",
      body: JSON.stringify(heartbeat),
    });
    if (!hb?.ok) {
      console.log("[hub] Takt: keine ok-Antwort vom Hub (Ausfall/Ablehnung) — still weiter");
      return;
    }
    console.log("[hub] Takt: heartbeat ok");

    // Befehle abholen
    const befehle = await hubAufruf<HubAntwort & { befehle?: HubBefehl[] }>(
      `/befehle?schluessel=${encodeURIComponent(schluessel)}`,
    );
    if (!befehle?.ok || !befehle.befehle?.length) return;

    for (const b of befehle.befehle) {
      console.log(`[hub] Befehl #${b.id}: ${b.typ}`);
      let ergebnis: { ok: boolean; detail: string; groesseMb?: number };
      try {
        if (b.typ === "backup") ergebnis = await backupAusfuehren();
        else if (b.typ === "diagnose") ergebnis = await diagnoseAusfuehren();
        else if (b.typ === "update-hinweis") ergebnis = await updateHinweisAusfuehren(b.payload);
        else if (b.typ === "ping") {
          ergebnis = { ok: true, detail: `pong ${new Date().toISOString()} (v${APP_VERSION}, uptime ${Math.round(process.uptime())}s)` };
        } else ergebnis = { ok: false, detail: `Unbekannter Befehlstyp: ${b.typ}` };
      } catch (e) {
        ergebnis = { ok: false, detail: e instanceof Error ? e.message : String(e) };
      }
      // API-Spezifikation: {schluessel, befehlId, erfolg, details?, groesseMb?}
      await hubAufruf("/ergebnis", {
        method: "POST",
        body: JSON.stringify({
          schluessel,
          befehlId: b.id,
          erfolg: ergebnis.ok,
          details: ergebnis.detail.slice(0, 4000),
          ...(ergebnis.groesseMb !== undefined ? { groesseMb: ergebnis.groesseMb } : {}),
        }),
      }).catch(() => undefined);
      console.log(`[hub] Befehl #${b.id} gemeldet: ${ergebnis.ok ? "ok" : "fehlgeschlagen"}`);
    }
  } catch (e) {
    // Nie die App stören — Hub-Fernverwaltung ist best effort.
    console.log(`[hub] Takt-Fehler: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Startet den Hub-Client (nur Produktion; einmalig beim Boot). */
export function starteHubClient() {
  setTimeout(hubZyklus, 90 * 1000); // erster Lauf 90 s nach Boot
  setInterval(hubZyklus, INTERVALL_MS);
  console.log(`[hub] Client aktiv (Pull alle ${INTERVALL_MS / 60000} min, Ziel ${HUB_URL})`);
}
