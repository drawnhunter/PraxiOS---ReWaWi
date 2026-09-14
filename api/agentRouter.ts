// ── Agent-API (Kimi Claw) ──────────────────────────────────────────────────
// REST-Endpunkte für externe Agenten unter /api/agent/* — Bearer-Token-Auth
// (sha256 in agent_tokens), Autonomie-Stufe aus company_settings:
//   vorschlag     = Lesen + Entwürfe/Aufgaben/Kunden; kein Versand
//   vollautomatik = zusätzlich Beleg-Versand per E-Mail
// Jede Schreib-Aktion wird in agent_log auditiert (sichtbar in Einstellungen).
import { Hono } from "hono";
import { createHash, randomBytes } from "node:crypto";
import { eq, desc } from "drizzle-orm";
import { getDb } from "./queries/connection";
import {
  agentTokens, agentAufgaben, agentLog, companySettings,
  customers, invoices, invoiceItems, reminders, bankImporte,
} from "@db/schema";
import { APP_VERSION } from "./lib/version";
import { computeTotals, centToDecimal } from "./queries/invoicing";
import { besterTreffer } from "@contracts/fuzzy";

const app = new Hono();

function hashToken(t: string): string {
  return createHash("sha256").update(t).digest("hex");
}

/** Neues Token erzeugen (Klartext nur bei der Anlage sichtbar). */
export function erzeugeAgentToken(): string {
  return `ax_${randomBytes(24).toString("hex")}`;
}
export { hashToken };

// ── Auth-Middleware ────────────────────────────────────────────────────────
app.use("*", async (c, next) => {
  const kopf = c.req.header("authorization") ?? "";
  const token = kopf.startsWith("Bearer ") ? kopf.slice(7).trim() : "";
  if (!token) return c.json({ fehler: "Bearer-Token fehlt (Authorization: Bearer ax_…)" }, 401);
  const treffer = await getDb().query.agentTokens.findFirst({
    where: eq(agentTokens.tokenHash, hashToken(token)),
  });
  if (!treffer || !treffer.aktiv) return c.json({ fehler: "Token ungültig oder deaktiviert." }, 401);
  getDb()
    .update(agentTokens)
    .set({ letzteNutzung: new Date() })
    .where(eq(agentTokens.id, treffer.id))
    .catch(() => undefined);
  return next();
});

async function audit(aktion: string, details?: unknown) {
  try {
    await getDb().insert(agentLog).values({
      aktion,
      details: details === undefined ? null : JSON.stringify(details).slice(0, 4000),
    });
  } catch { /* Audit darf nie blockieren */ }
}

async function autonomie(): Promise<"vorschlag" | "vollautomatik"> {
  const s = await getDb().query.companySettings.findFirst({
    where: eq(companySettings.id, 1),
    columns: { agentAutonomie: true },
  });
  return s?.agentAutonomie === "vollautomatik" ? "vollautomatik" : "vorschlag";
}

const heute = () => new Date().toISOString().slice(0, 10);

// ── Lesen ──────────────────────────────────────────────────────────────────
app.get("/status", async (c) => {
  return c.json({ produkt: process.env.SUPPORT_PRODUKT || "ReWaWi", version: APP_VERSION, zeit: new Date().toISOString() });
});

app.get("/offene-rechnungen", async (c) => {
  const db = getDb();
  const { ladeSynonymKarte, agentName } = await import("./lib/pseudonym");
  const karte = await ladeSynonymKarte();
  const rows = await db.select().from(invoices).where(eq(invoices.status, "finalisiert"));
  const h = heute();
  const offene = rows
    .filter((r) => Number(r.brutto) - Number(r.bezahltBetrag) > 0.004)
    .map((r) => ({
      id: r.id,
      nummer: r.nummer,
      kunde: agentName(karte, r.customerId, r.kundeName),
      kundenId: r.customerId,
      brutto: Number(r.brutto),
      offen: Number(r.brutto) - Number(r.bezahltBetrag),
      rechnungsdatum: r.rechnungsdatum,
      faelligkeitsdatum: r.faelligkeitsdatum,
      ueberfaellig: r.faelligkeitsdatum < h,
    }))
    .sort((a, b) => (a.faelligkeitsdatum < b.faelligkeitsdatum ? -1 : 1));
  return c.json({ anzahl: offene.length, ueberfaellig: offene.filter((o) => o.ueberfaellig).length, rechnungen: offene });
});

app.get("/entwuerfe", async (c) => {
  const { ladeSynonymKarte, agentName } = await import("./lib/pseudonym");
  const karte = await ladeSynonymKarte();
  const rows = await getDb().query.invoices.findMany({
    where: eq(invoices.status, "entwurf"),
    orderBy: [desc(invoices.createdAt)],
  });
  return c.json({
    anzahl: rows.length,
    entwuerfe: rows.map((r) => ({
      id: r.id, kunde: agentName(karte, r.customerId, r.kundeName), kundenId: r.customerId,
      netto: Number(r.netto), brutto: Number(r.brutto), datum: r.rechnungsdatum,
    })),
  });
});

app.get("/kunden-ohne-rechnung", async (c) => {
  const tage = Math.max(7, Math.min(365, Number(c.req.query("tage") ?? "30")));
  const schwelle = new Date(Date.now() - tage * 86400000).toISOString().slice(0, 10);
  const db = getDb();
  const { ladeSynonymKarte, agentName } = await import("./lib/pseudonym");
  const karte = await ladeSynonymKarte();
  const [alle, finale] = await Promise.all([
    db.select().from(customers),
    db.select().from(invoices).where(eq(invoices.status, "finalisiert")),
  ]);
  const letzteJeKunde = new Map<number, string>();
  for (const r of finale) {
    const bisher = letzteJeKunde.get(r.customerId);
    if (!bisher || r.rechnungsdatum > bisher) letzteJeKunde.set(r.customerId, r.rechnungsdatum);
  }
  const faellig = alle
    .filter((k) => (letzteJeKunde.get(k.id) ?? "0000-00-00") < schwelle)
    .map((k) => ({
      id: k.id,
      name: agentName(karte, k.id, k.name),
      email: karte.aktiv && k.email ? `…@${k.email.split("@")[1] ?? ""}` : k.email,
      letzteRechnung: letzteJeKunde.get(k.id) ?? null,
    }))
    .sort((a, b) => ((a.letzteRechnung ?? "") < (b.letzteRechnung ?? "") ? -1 : 1));
  return c.json({ tage, anzahl: faellig.length, kunden: faellig });
});

app.get("/mahnungen", async (c) => {
  const db = getDb();
  const { ladeSynonymKarte, agentName } = await import("./lib/pseudonym");
  const karte = await ladeSynonymKarte();
  const h = heute();
  const alle = await db.select().from(invoices).where(eq(invoices.status, "finalisiert"));
  const alleMahnungen = await db.select().from(reminders);
  const offene = alle.filter((r) => Number(r.brutto) - Number(r.bezahltBetrag) > 0.004 && r.faelligkeitsdatum < h);
  return c.json({
    anzahl: offene.length,
    faellig: offene.map((r) => {
      const stufen = alleMahnungen.filter((m) => m.invoiceId === r.id);
      const hoechste = stufen.reduce((a, m) => Math.max(a, m.stufe), 0);
      return {
        rechnungId: r.id, nummer: r.nummer, kunde: agentName(karte, r.customerId, r.kundeName),
        faelligkeitsdatum: r.faelligkeitsdatum,
        offen: Number(r.brutto) - Number(r.bezahltBetrag),
        stufenBisher: stufen.length, naechsteStufe: Math.min(3, hoechste + 1),
      };
    }),
  });
});

// ── Bank: Buchungen, Abgleich, Kontostand ──────────────────────────────────
app.get("/bankbuchungen", async (c) => {
  const tage = Math.max(1, Math.min(365, Number(c.req.query("tage") ?? "30")));
  const seit = new Date(Date.now() - tage * 86400000).toISOString().slice(0, 10);
  const { bankTransaktionen, bankAccounts } = await import("@db/schema");
  const { gte, asc } = await import("drizzle-orm");
  const { kategorien } = await import("@db/schema");
  const { ladeSynonymKarte, maskiereGegenstelle } = await import("./lib/pseudonym");
  const karte = await ladeSynonymKarte();
  const rows = await getDb()
    .select({ t: bankTransaktionen, konto: bankAccounts.bezeichnung, kategorieName: kategorien.name })
    .from(bankTransaktionen)
    .leftJoin(bankAccounts, eq(bankTransaktionen.bankAccountId, bankAccounts.id))
    .leftJoin(kategorien, eq(bankTransaktionen.kategorieId, kategorien.id))
    .where(gte(bankTransaktionen.datum, seit))
    .orderBy(asc(bankTransaktionen.datum));
  return c.json({
    tage,
    anzahl: rows.length,
    buchungen: rows.map((r) => ({
      id: r.t.id,
      datum: r.t.datum,
      betrag: Number(r.t.betrag),
      name: maskiereGegenstelle(karte, r.t.name),
      zweck: r.t.zweck,
      konto: r.konto,
      status: r.t.status,
      quellId: r.t.quellId,
      kategorieId: r.t.kategorieId,
      kategorieName: r.kategorieName,
      eingangsbelegId: r.t.incomingInvoiceId,
      gebuehr: r.t.gebuehr ? Number(r.t.gebuehr) : null,
    })),
  });
});

app.get("/bankbuchung/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const { bankTransaktionen } = await import("@db/schema");
  const t = await getDb().query.bankTransaktionen.findFirst({
    where: eq(bankTransaktionen.id, id),
  });
  if (!t) return c.json({ fehler: "Buchung nicht gefunden." }, 404);
  const { ladeSynonymKarte, maskiereGegenstelle } = await import("./lib/pseudonym");
  const karte = await ladeSynonymKarte();
  return c.json({ ...t, name: maskiereGegenstelle(karte, t.name) });
});

app.get("/kontostand", async (c) => {
  const { bankAccounts, bankTransaktionen } = await import("@db/schema");
  const { and, desc, sql } = await import("drizzle-orm");
  const db = getDb();
  const konten = await db.select().from(bankAccounts);
  const aus = [];
  for (const k of konten) {
    const letzteSaldo = await db
      .select({ saldo: bankTransaktionen.saldoNach })
      .from(bankTransaktionen)
      .where(and(eq(bankTransaktionen.bankAccountId, k.id), sql`${bankTransaktionen.saldoNach} IS NOT NULL`))
      .orderBy(desc(bankTransaktionen.datum), desc(bankTransaktionen.id))
      .limit(1);
    const [agg] = await db
      .select({ summe: sql<string>`COALESCE(SUM(${bankTransaktionen.betrag}), 0)` })
      .from(bankTransaktionen)
      .where(eq(bankTransaktionen.bankAccountId, k.id));
    aus.push({
      kontoId: k.id,
      bezeichnung: k.bezeichnung,
      iban: k.iban,
      saldo: letzteSaldo[0]?.saldo !== null && letzteSaldo[0]?.saldo !== undefined
        ? Number(letzteSaldo[0].saldo)
        : Number(agg?.summe ?? 0),
      quelle: letzteSaldo.length > 0 ? "saldoNach" : "summe",
    });
  }
  return c.json({ konten: aus });
});

app.get("/zahlungsabgleich", async (c) => {
  const { autoMatch } = await import("./bankTransaktionenRouter");
  const { bankTransaktionen, bankAccounts } = await import("@db/schema");
  const { asc } = await import("drizzle-orm");
  const { ladeSynonymKarte, maskiereGegenstelle } = await import("./lib/pseudonym");
  const karte = await ladeSynonymKarte();
  const db = getDb();
  const offene = await db
    .select({ t: bankTransaktionen, konto: bankAccounts.bezeichnung })
    .from(bankTransaktionen)
    .leftJoin(bankAccounts, eq(bankTransaktionen.bankAccountId, bankAccounts.id))
    .where(eq(bankTransaktionen.status, "offen"))
    .orderBy(asc(bankTransaktionen.datum))
    .limit(60);
  const aus = [];
  for (const r of offene) {
    const vorschlag = await autoMatch({
      datum: r.t.datum,
      betrag: Number(r.t.betrag),
      name: r.t.name,
      zweck: r.t.zweck ?? "",
      gebuehr: r.t.gebuehr ? Number(r.t.gebuehr) : null,
      saldo: r.t.saldoNach ? Number(r.t.saldoNach) : null,
    });
    aus.push({
      transaktionId: r.t.id,
      datum: r.t.datum,
      betrag: Number(r.t.betrag),
      name: maskiereGegenstelle(karte, r.t.name),
      konto: r.konto,
      vorschlag: vorschlag
        ? {
            typ: vorschlag.typ,
            rechnungOderBeleg: vorschlag.nummer,
            kunde: maskiereGegenstelle(karte, vorschlag.bezeichner),
            offenBetrag: vorschlag.offenBetrag,
            sicherheit: vorschlag.sicherheit,
          }
        : null,
    });
  }
  return c.json({
    anzahl: aus.length,
    mitVorschlag: aus.filter((a) => a.vorschlag).length,
    buchungen: aus,
  });
});

// ── Kunden & Katalog & Einzelbeleg ─────────────────────────────────────────
app.get("/kunden", async (c) => {
  const rows = await getDb().select().from(customers);
  const { ladeSynonymKarte, agentName } = await import("./lib/pseudonym");
  const karte = await ladeSynonymKarte();
  return c.json({
    anzahl: rows.length,
    kunden: rows.map((k) => ({
      id: k.id,
      name: agentName(karte, k.id, k.name),
      ...(karte.aktiv
        ? { ort: k.ort } // Pseudonym-Modus: nur Stadt-Ebene, keine Straße/PLZ/E-Mail
        : { zusatz: k.zusatz, strasse: k.strasse, plz: k.plz, ort: k.ort, land: k.land, email: k.email }),
      land: k.land,
      zahlungszielTage: k.zahlungszielTage,
    })),
  });
});

app.get("/leistungskatalog", async (c) => {
  const rows = (await getDb().query.products.findMany()).filter((p) => p.aktiv);
  return c.json({
    anzahl: rows.length,
    produkte: rows.map((p) => ({
      id: p.id, name: p.name, artikelnummer: p.artikelnummer,
      beschreibung: p.beschreibung, einheit: p.einheit,
      preisNetto: Number(p.preisNetto), ustSatz: p.ustSatz, kategorie: p.kategorie,
    })),
  });
});

app.get("/rechnung/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const r = await getDb().query.invoices.findFirst({
    where: eq(invoices.id, id),
    with: { items: true },
  });
  if (!r) return c.json({ fehler: "Rechnung nicht gefunden." }, 404);
  r.items.sort((a, b) => a.position - b.position);
  const { ladeSynonymKarte, agentName } = await import("./lib/pseudonym");
  const karte = await ladeSynonymKarte();
  return c.json({
    id: r.id, nummer: r.nummer, status: r.status,
    kunde: agentName(karte, r.customerId, r.kundeName), kundenId: r.customerId,
    rechnungsdatum: r.rechnungsdatum, faelligkeitsdatum: r.faelligkeitsdatum,
    netto: Number(r.netto), ust: Number(r.ust), brutto: Number(r.brutto),
    bezahltBetrag: Number(r.bezahltBetrag),
    positionen: r.items.map((it) => ({
      position: it.position, bezeichnung: it.bezeichnung, beschreibung: it.beschreibung,
      menge: Number(it.menge), einheit: it.einheit, einzelpreis: Number(it.einzelpreis), ustSatz: it.ustSatz,
    })),
  });
});

/** Body tolerant lesen: JSON, Formular ODER Rohtext mit Anführungszeichen-Mantel
    (Windows-curl schickt '-d \'{"a":1}\'' mit den einfachen Anführungszeichen im
    Body — das ist kein gültiges JSON und fraß bisher still den Stream). */
async function bodyLesen(c: { req: { json: () => Promise<Record<string, unknown>>; parseBody: () => Promise<Record<string, unknown>>; text: () => Promise<string> } }): Promise<Record<string, unknown>> {
  try {
    const j = await c.req.json();
    if (j && typeof j === "object") return j as Record<string, unknown>;
  } catch { /* Fallbacks weiter unten */ }
  try {
    const f = await c.req.parseBody();
    if (f && Object.keys(f).length > 0) return f as Record<string, unknown>;
  } catch { /* weiter */ }
  try {
    const roh = (await c.req.text()).trim().replace(/^'+|'+$/g, "").trim();
    if (roh.startsWith("{") || roh.startsWith("[")) {
      return JSON.parse(roh) as Record<string, unknown>;
    }
  } catch { /* unlesbar */ }
  return {};
}

/** items aus Body: echtes Array ODER JSON-String (Form-Data kann nicht verschachteln). */
function itemsNormalisieren(body: Record<string, unknown>): unknown[] {
  const roh = body.items;
  if (Array.isArray(roh)) return roh;
  if (typeof roh === "string") {
    try {
      const p = JSON.parse(roh);
      return Array.isArray(p) ? p : [];
    } catch { /* unten: Fehlermeldung */ }
  }
  return [];
}

/** Ausgangsrechnung per interner ID ODER Nummer (Agent denkt in Nummern). */
async function rechnungFinden(idOderNummer: number | string) {
  const db = getDb();
  const n = Number(idOderNummer);
  if (Number.isFinite(n) && n > 0 && String(idOderNummer).match(/^\d+$/)) {
    const perId = await db.query.invoices.findFirst({ where: eq(invoices.id, n) });
    if (perId) return perId;
  }
  return db.query.invoices.findFirst({ where: eq(invoices.nummer, String(idOderNummer)) });
}

// ── Zuordnung schreiben/loesen (produktionserprobte Logik mit Reversal) ────
app.post("/bankbuchung/:id/zuordnen", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await bodyLesen(c);
  const rechnungKey = body.rechnungId ?? body.nummer ?? null;
  const eingangsrechnungId = body.eingangsrechnungId ? Number(body.eingangsrechnungId) : null;
  if (!rechnungKey && !eingangsrechnungId) {
    return c.json({ ok: false, fehler: "rechnungId/nummer (Ausgangsrechnung) oder eingangsrechnungId (Eingangsbeleg) angeben." }, 400);
  }
  const { zuordneIntern } = await import("./bankTransaktionenRouter");
  try {
    if (rechnungKey) {
      const r = await rechnungFinden(rechnungKey as number | string);
      if (!r) {
        return c.json({ ok: false, fehler: `Ausgangsrechnung „${rechnungKey}" nicht gefunden — interne ID (z. B. 17) oder Nummer (z. B. 2026-017) angeben.` }, 404);
      }
      await zuordneIntern(id, "ausgang", r.id);
      await audit("buchung_zugeordnet", { transaktionId: id, typ: "ausgang", rechnungId: r.id, nummer: r.nummer });
      return c.json({ ok: true, typ: "ausgang", rechnungId: r.id, nummer: r.nummer });
    }
    await zuordneIntern(id, "eingang", eingangsrechnungId!);
    await audit("buchung_zugeordnet", { transaktionId: id, typ: "eingang", eingangsrechnungId });
    return c.json({ ok: true, typ: "eingang", eingangsrechnungId });
  } catch (e) {
    return c.json({ ok: false, fehler: e instanceof Error ? e.message : String(e) }, 409);
  }
});

app.post("/bankbuchung/:id/loesen", async (c) => {
  const id = Number(c.req.param("id"));
  const { zuordnungLoesenIntern } = await import("./bankTransaktionenRouter");
  try {
    await zuordnungLoesenIntern(id);
    await audit("buchung_zuordnung_geloesen", { transaktionId: id });
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ fehler: e instanceof Error ? e.message : String(e) }, 409);
  }
});

// ── Mahnung anlegen (Vorschlag — Versand bleibt beim Menschen) ─────────────
app.post("/mahnung", async (c) => {
  const body = await bodyLesen(c);
  const rechnungId = Number(body.rechnungId);
  const stufe = Number(body.stufe ?? 1);
  if (!rechnungId || ![1, 2, 3].includes(stufe)) {
    return c.json({ fehler: "rechnungId und stufe (1–3) nötig." }, 400);
  }
  const db = getDb();
  const r = await db.query.invoices.findFirst({ where: eq(invoices.id, rechnungId) });
  if (!r) return c.json({ fehler: "Rechnung nicht gefunden." }, 404);
  if (r.status !== "finalisiert") return c.json({ fehler: "Mahnungen gibt es nur zu finalisierten Rechnungen." }, 409);
  const offen = Number(r.brutto) - Number(r.bezahltBetrag);
  if (offen <= 0) return c.json({ fehler: "Die Rechnung ist bereits bezahlt." }, 409);

  const frist = new Date();
  frist.setDate(frist.getDate() + 10);
  const [{ id }] = await db
    .insert(reminders)
    .values({
      invoiceId: r.id,
      stufe,
      datum: heute(),
      zahlungsfrist: body.zahlungsfrist ? String(body.zahlungsfrist) : frist.toISOString().slice(0, 10),
      offenBetrag: offen.toFixed(2),
      bemerkung: "Per Agent-API (Kimi Claw) angelegt",
    })
    .$returningId();
  await audit("mahnung_angelegt", { id, rechnungId, stufe, nummer: r.nummer });
  return c.json({ ok: true, id, stufe, nummer: r.nummer, hinweis: "Mahnung angelegt — PDF/Versand erfolgt durch einen Menschen." });
});

// ── Entwurf löschen (nur Entwürfe, GoBD) ───────────────────────────────────
app.delete("/entwurf/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const db = getDb();
  const r = await db.query.invoices.findFirst({ where: eq(invoices.id, id) });
  if (!r) return c.json({ fehler: "Rechnung nicht gefunden." }, 404);
  if (r.status !== "entwurf") return c.json({ fehler: "Nur Entwürfe sind löschbar (GoBD). Finalisierte Rechnungen bleiben unveränderbar." }, 409);
  await db.transaction(async (tx) => {
    await tx.delete(invoiceItems).where(eq(invoiceItems.invoiceId, id));
    await tx.delete(invoices).where(eq(invoices.id, id));
  });
  await audit("entwurf_geloescht", { id, kunde: r.kundeName });
  return c.json({ ok: true, geloescht: id, kunde: r.kundeName });
});

app.get("/import-status", async (c) => {
  const rows = await getDb().query.bankImporte.findMany({ orderBy: [desc(bankImporte.createdAt)] });
  const letzter = rows[0];
  const tage = letzter
    ? Math.floor((Date.now() - letzter.createdAt.getTime()) / 86400000)
    : null;
  return c.json({
    letzterImport: letzter ? { datum: letzter.createdAt.toISOString(), dateiname: letzter.dateiname, zeilen: letzter.zeilen } : null,
    tageSeitImport: tage,
    erinnerungFaellig: tage === null || tage >= 5,
  });
});

// ── Aufgabenliste ──────────────────────────────────────────────────────────
app.get("/aufgaben", async (c) => {
  const rows = await getDb().query.agentAufgaben.findMany({ orderBy: [desc(agentAufgaben.createdAt)] });
  return c.json({
    offen: rows.filter((r) => !r.erledigt),
    erledigt: rows.filter((r) => r.erledigt).slice(0, 20),
  });
});

app.post("/aufgaben", async (c) => {
  const body = await bodyLesen(c);
  const text = String(body.text ?? "").trim();
  if (!text || text.length > 500) return c.json({ fehler: "text fehlt (max. 500 Zeichen)." }, 400);
  const [{ id }] = await getDb()
    .insert(agentAufgaben)
    .values({ text, quelle: "agent" })
    .$returningId();
  await audit("aufgabe_angelegt", { id, text });
  return c.json({ ok: true, id });
});

app.post("/aufgaben/:id/erledigt", async (c) => {
  const id = Number(c.req.param("id"));
  const db = getDb();
  const aufgabe = await db.query.agentAufgaben.findFirst({ where: eq(agentAufgaben.id, id) });
  if (!aufgabe) return c.json({ fehler: "Aufgabe nicht gefunden." }, 404);
  await db
    .update(agentAufgaben)
    .set({ erledigt: !aufgabe.erledigt, erledigtAm: aufgabe.erledigt ? null : new Date() })
    .where(eq(agentAufgaben.id, id));
  await audit("aufgabe_erledigt_gewechselt", { id, erledigt: !aufgabe.erledigt });
  return c.json({ ok: true, erledigt: !aufgabe.erledigt });
});

// ── Schreiben ──────────────────────────────────────────────────────────────
app.post("/kunde", async (c) => {
  const body = await bodyLesen(c);
  const name = String(body.name ?? "").trim();
  if (!name) return c.json({ fehler: "name fehlt." }, 400);
  const db = getDb();
  const [{ id }] = await db
    .insert(customers)
    .values({
      name,
      zusatz: body.zusatz ? String(body.zusatz) : null,
      strasse: String(body.strasse ?? "—"),
      plz: String(body.plz ?? "—"),
      ort: String(body.ort ?? "—"),
      land: body.land ? String(body.land) : "Deutschland",
      email: body.email ? String(body.email) : null,
    })
    .$returningId();
  const { vergibSynonym } = await import("./lib/pseudonym");
  const synonym = await vergibSynonym("customers", id);
  await audit("kunde_angelegt", { id, name, synonym });
  return c.json({ ok: true, id, name, synonym });
});

app.post("/rechnung-entwurf", async (c) => {
  const body = await bodyLesen(c);
  const db = getDb();

  if (Object.keys(body).length === 0) {
    return c.json({
      fehler: "Body fehlt oder ist kein gültiges JSON. Hinweis: In Windows-curl doppelte Anführungszeichen nutzen bzw. -d @datei.json — einfache Anführungszeichen werden mitgesendet.",
    }, 400);
  }

  // Kunde: per ID, per ID im Feld kundenId, oder per Namen (Fuzzy)
  let kunde: typeof customers.$inferSelect | undefined;
  const idKandidat = body.kundenId ?? body.id;
  if (idKandidat) {
    kunde = await db.query.customers.findFirst({ where: eq(customers.id, Number(idKandidat)) });
  } else if (body.kunde) {
    const alle = await db.select().from(customers);
    const t = besterTreffer(alle, String(body.kunde), (k) => k.name);
    kunde = t?.treffer;
  }
  if (!kunde) {
    return c.json({
      fehler: `Kunde nicht gefunden. Empfangen: kundenId=${String(body.kundenId ?? "—")}, kunde=${String(body.kunde ?? "—")}. IDs per GET /kunden prüfen; Name muss annähernd stimmen (Fuzzy).`,
    }, 404);
  }

  const items = itemsNormalisieren(body);
  if (items.length === 0) return c.json({ fehler: "items fehlt: [{bezeichnung, menge?, einzelpreis, ustSatz?}] — als Array im JSON oder als JSON-String im Form-Feld." }, 400);
  const positionen = (items as Record<string, unknown>[]).map((it, i: number) => ({
    position: i + 1,
    bezeichnung: String(it.bezeichnung ?? "").slice(0, 500),
    beschreibung: it.beschreibung ? String(it.beschreibung) : null,
    menge: String(it.menge ?? "1"),
    einheit: String(it.einheit ?? "Stück"),
    einzelpreis: String(it.einzelpreis ?? "0"),
    ustSatz: [19, 7, 0].includes(Number(it.ustSatz)) ? Number(it.ustSatz) : 19,
  }));
  if (positionen.some((p: { bezeichnung: string }) => !p.bezeichnung)) return c.json({ fehler: "Jede Position braucht eine bezeichnung." }, 400);

  const settings = await db.query.companySettings.findFirst({ where: eq(companySettings.id, 1) });
  const zielTage = kunde.zahlungszielTage ?? settings?.standardZahlungsziel ?? 14;
  const heuteD = new Date();
  const faellig = new Date(heuteD.getTime() + zielTage * 86400000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const standardBank = await db.query.bankAccounts.findFirst({ where: (b, { eq: e }) => e(b.istStandard, true) });

  const totals = computeTotals(positionen);
  const [{ id }] = await db
    .insert(invoices)
    .values({
      customerId: kunde.id,
      rechnungsdatum: fmt(heuteD),
      faelligkeitsdatum: fmt(faellig),
      bankAccountId: standardBank?.id ?? null,
      kundeName: kunde.name,
      kundeZusatz: kunde.zusatz,
      kundeStrasse: kunde.strasse,
      kundePlz: kunde.plz,
      kundeOrt: kunde.ort,
      kundeLand: kunde.land,
      pdfNotiz: body.pdfNotiz ? String(body.pdfNotiz) : null,
      bemerkung: "Erstellt per Agent-API (Kimi Claw) — bitte prüfen.",
      netto: centToDecimal(totals.nettoCent),
      ust: centToDecimal(totals.ustCent),
      brutto: centToDecimal(totals.bruttoCent),
    })
    .$returningId();
  await db.insert(invoiceItems).values(
    positionen.map((p) => ({
      invoiceId: id,
      position: p.position,
      bezeichnung: p.bezeichnung,
      beschreibung: p.beschreibung,
      menge: p.menge,
      einheit: p.einheit,
      einzelpreis: p.einzelpreis,
      ustSatz: p.ustSatz,
    })),
  );
  const { ladeSynonymKarte, agentName } = await import("./lib/pseudonym");
  const karte = await ladeSynonymKarte();
  const kundeAnzeige = agentName(karte, kunde.id, kunde.name);
  await audit("rechnung_entwurf", { id, kunde: kundeAnzeige, positionen: positionen.length, brutto: centToDecimal(totals.bruttoCent) });
  return c.json({ ok: true, id, kunde: kundeAnzeige, kundenId: kunde.id, brutto: centToDecimal(totals.bruttoCent), hinweis: "Entwurf angelegt — Freigabe erfolgt durch einen Menschen (oder Vollautomatik in Einstellungen)." });
});

app.post("/rechnung/:id/versenden", async (c) => {
  const stufe = await autonomie();
  if (stufe !== "vollautomatik") {
    return c.json(
      {
        fehler: "Versand ist in der Autonomie-Stufe „vorschlag“ gesperrt. Entwurf prüfen und manuell versenden — oder Einstellungen → Agent-API auf „vollautomatik“ stellen.",
      },
      403,
    );
  }
  const id = Number(c.req.param("id"));
  const body = await bodyLesen(c);
  const db = getDb();
  const r = await db.query.invoices.findFirst({ where: eq(invoices.id, id), with: { items: true, bankAccount: true } });
  if (!r) return c.json({ fehler: "Rechnung nicht gefunden." }, 404);
  if (r.status === "entwurf") return c.json({ fehler: "Rechnung ist noch Entwurf — erst finalisieren (bewusst nur per Hand oder späterer Freigabe-Stufe)." }, 409);

  const kundeRow = await db.query.customers.findFirst({ where: eq(customers.id, r.customerId) });
  const empfaenger = String(body.empfaenger ?? kundeRow?.email ?? "").trim();
  if (!empfaenger) return c.json({ fehler: "Keine Empfänger-Adresse (empfaenger angeben oder beim Kunden hinterlegen)." }, 400);

  const { ladeRechnungsBeleg } = await import("./pdfBelege");
  const { renderBelegPdf } = await import("./pdf");
  const { ladeSmtp } = await import("./lib/smtp");
  const { ladeDesign, ladeFirmaLive } = await import("./pdfBelege");
  const { mailLog } = await import("@db/schema");

  const { beleg, dateiname } = await ladeRechnungsBeleg(id);
  const pdf = await renderBelegPdf(beleg, await ladeDesign());
  const betreff = String(body.betreff ?? `Rechnung ${r.nummer ?? id}`);
  const text = String(body.text ?? `Anbei Ihre Rechnung ${r.nummer ?? id} als PDF.`);
  const { transporter, absender } = await ladeSmtp();

  let erfolg = true;
  let fehler: string | null = null;
  try {
    await transporter.sendMail({
      from: `"${absender}" <${(await ladeFirmaLive()).email ?? absender}>`,
      to: empfaenger,
      subject: betreff,
      text,
      attachments: [{ filename: `Rechnung ${dateiname}.pdf`, content: pdf, contentType: "application/pdf" }],
    });
  } catch (e) {
    erfolg = false;
    fehler = e instanceof Error ? e.message : String(e);
  }
  await db.insert(mailLog).values({ belegArt: "invoice", belegId: id, empfaenger, betreff, erfolg, fehler });
  await audit("rechnung_versendet", { id, empfaenger, erfolg, fehler });
  if (!erfolg) return c.json({ fehler: `Versand fehlgeschlagen: ${fehler}` }, 502);
  return c.json({ ok: true, empfaenger });
});

// ── Kategorien (Kontierung/DATEV) ──────────────────────────────────────────
app.get("/kategorien", async (c) => {
  const { kategorien } = await import("@db/schema");
  const rows = await getDb().select().from(kategorien);
  return c.json({
    anzahl: rows.length,
    kategorien: rows.map((k) => ({ id: k.id, name: k.name, konto: k.konto, ustSatz: k.ustSatz, typ: k.typ })),
  });
});

app.post("/kategorie", async (c) => {
  const body = await bodyLesen(c);
  const name = String(body.name ?? "").trim();
  if (!name) return c.json({ ok: false, fehler: "name fehlt." }, 400);
  const { kategorien } = await import("@db/schema");
  const db = getDb();
  const maxSort = (await db.query.kategorien.findFirst({ orderBy: (k, { desc: d }) => d(k.sortierung) }))?.sortierung ?? 0;
  const [{ id }] = await db
    .insert(kategorien)
    .values({
      name,
      konto: body.konto ? String(body.konto) : null,
      ustSatz: [19, 7, 0].includes(Number(body.ustSatz)) ? Number(body.ustSatz) : 19,
      typ: body.typ === "einnahme" ? "einnahme" : "ausgabe",
      sortierung: maxSort + 1,
    })
    .$returningId();
  await audit("kategorie_angelegt", { id, name });
  return c.json({ ok: true, id, name });
});

app.patch("/kategorie/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await bodyLesen(c);
  const { kategorien } = await import("@db/schema");
  const db = getDb();
  const kat = await db.query.kategorien.findFirst({ where: eq(kategorien.id, id) });
  if (!kat) return c.json({ ok: false, fehler: "Kategorie nicht gefunden." }, 404);
  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) patch.name = String(body.name).trim();
  if (body.konto !== undefined) patch.konto = body.konto === null || body.konto === "" ? null : String(body.konto);
  if (body.ustSatz !== undefined) patch.ustSatz = Number(body.ustSatz);
  if (body.typ !== undefined) patch.typ = body.typ === "einnahme" ? "einnahme" : "ausgabe";
  if (Object.keys(patch).length === 0) return c.json({ ok: false, fehler: "Nichts zu ändern (name/konto/ustSatz/typ)." }, 400);
  await db.update(kategorien).set(patch).where(eq(kategorien.id, id));
  await audit("kategorie_geaendert", { id, ...patch });
  return c.json({ ok: true, id });
});

app.delete("/kategorie/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const { kategorien, bankTransaktionen } = await import("@db/schema");
  const db = getDb();
  const kat = await db.query.kategorien.findFirst({ where: eq(kategorien.id, id) });
  if (!kat) return c.json({ ok: false, fehler: "Kategorie nicht gefunden." }, 404);
  const genutzt = await db.query.bankTransaktionen.findFirst({
    where: eq(bankTransaktionen.kategorieId, id),
    columns: { id: true },
  });
  if (genutzt) return c.json({ ok: false, fehler: "Kategorie ist Bankbuchungen zugeordnet — erst umkategorisieren." }, 409);
  await db.delete(kategorien).where(eq(kategorien.id, id));
  await audit("kategorie_geloescht", { id, name: kat.name });
  return c.json({ ok: true, geloescht: id });
});

// ── Buchung kategorisieren (einzeln + Massen) ──────────────────────────────
app.post("/bankbuchung/:id/kategorie", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await bodyLesen(c);
  const kategorieId = Number(body.kategorieId);
  if (!kategorieId) return c.json({ ok: false, fehler: "kategorieId fehlt." }, 400);
  const { bankTransaktionen, kategorien } = await import("@db/schema");
  const db = getDb();
  const t = await db.query.bankTransaktionen.findFirst({ where: eq(bankTransaktionen.id, id) });
  if (!t) return c.json({ ok: false, fehler: "Buchung nicht gefunden." }, 404);
  const kat = await db.query.kategorien.findFirst({ where: eq(kategorien.id, kategorieId) });
  if (!kat) return c.json({ ok: false, fehler: "Kategorie nicht gefunden." }, 404);
  await db
    .update(bankTransaktionen)
    .set({
      kategorieId,
      ...(body.notiz ? { bemerkung: String(body.notiz).slice(0, 500) } : {}),
    })
    .where(eq(bankTransaktionen.id, id));
  await audit("buchung_kategorisiert", { id, kategorieId, kategorie: kat.name });
  return c.json({ ok: true, id, kategorie: kat.name });
});

app.post("/bankbuchungen/kategorisieren", async (c) => {
  const body = await bodyLesen(c);
  const zuordnungen = Array.isArray(body.zuordnungen) ? body.zuordnungen : [];
  if (zuordnungen.length === 0) return c.json({ ok: false, fehler: "zuordnungen fehlt: [{bankbuchungId, kategorieId, notiz?}]" }, 400);
  const { zuordneKategorieIntern } = await import("./bankTransaktionenRouter");
  let ok = 0;
  const fehler: string[] = [];
  for (const z of zuordnungen as Record<string, unknown>[]) {
    try {
      await zuordneKategorieIntern(Number(z.bankbuchungId), Number(z.kategorieId), z.notiz ? String(z.notiz) : null);
      ok++;
    } catch (e) {
      fehler.push(`#${String(z.bankbuchungId)}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  await audit("buchungen_kategorisiert", { ok, fehler: fehler.length });
  return c.json({ ok: true, kategorisiert: ok, fehler });
});

// ── Regel-Engine: Muster → Kategorie ───────────────────────────────────────
app.get("/kategorie-regeln", async (c) => {
  const { bankRegeln, kategorien } = await import("@db/schema");
  const { asc } = await import("drizzle-orm");
  const rows = await getDb()
    .select({ r: bankRegeln, kategorieName: kategorien.name })
    .from(bankRegeln)
    .leftJoin(kategorien, eq(bankRegeln.kategorieId, kategorien.id))
    .orderBy(asc(bankRegeln.prio));
  return c.json({ regeln: rows.map((r) => ({ ...r.r, kategorieName: r.kategorieName })) });
});

app.post("/kategorie-regel", async (c) => {
  const body = await bodyLesen(c);
  const kategorieId = Number(body.kategorieId);
  const pattern = String(body.pattern ?? "").trim();
  if (!kategorieId || !pattern) return c.json({ ok: false, fehler: "kategorieId + pattern nötig (pattern: Text oder A|B|C)." }, 400);
  const { bankRegeln, kategorien } = await import("@db/schema");
  const db = getDb();
  const kat = await db.query.kategorien.findFirst({ where: eq(kategorien.id, kategorieId) });
  if (!kat) return c.json({ ok: false, fehler: "Kategorie nicht gefunden." }, 404);
  const [{ id }] = await db
    .insert(bankRegeln)
    .values({
      kategorieId,
      pattern,
      feld: body.feld === "zweck" ? "zweck" : "name",
      prio: Math.max(1, Math.min(999, Number(body.prio ?? 10))),
    })
    .$returningId();
  await audit("kategorie_regel_angelegt", { id, kategorieId, pattern });
  return c.json({ ok: true, id });
});

app.delete("/kategorie-regel/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const { bankRegeln } = await import("@db/schema");
  await getDb().delete(bankRegeln).where(eq(bankRegeln.id, id));
  await audit("kategorie_regel_geloescht", { id });
  return c.json({ ok: true, geloescht: id });
});

app.post("/bankbuchungen/auto-kategorisieren", async (c) => {
  const { wendeBankRegelnAn } = await import("./bankTransaktionenRouter");
  const ergebnis = await wendeBankRegelnAn();
  await audit("auto_kategorisieren", ergebnis);
  return c.json({ ok: true, ...ergebnis });
});

// ── Belegkette: Eingangsbelege anlegen/lesen, mit Bank-Verknüpfung ─────────
app.get("/belege", async (c) => {
  const { incomingInvoices, kategorien } = await import("@db/schema");
  const { desc } = await import("drizzle-orm");
  const { ladeSynonymKarte, agentLieferant } = await import("./lib/pseudonym");
  const karte = await ladeSynonymKarte();
  const rows = await getDb()
    .select({ e: incomingInvoices, kategorieName: kategorien.name })
    .from(incomingInvoices)
    .leftJoin(kategorien, eq(incomingInvoices.kategorieId, kategorien.id))
    .orderBy(desc(incomingInvoices.createdAt))
    .limit(200);
  return c.json({
    anzahl: rows.length,
    belege: rows.map((r) => ({
      id: r.e.id, lieferant: agentLieferant(karte, r.e.lieferantName), nummer: r.e.nummer,
      rechnungsdatum: r.e.rechnungsdatum, netto: Number(r.e.netto),
      ust: Number(r.e.ust), brutto: Number(r.e.brutto),
      konto: r.e.konto, kategorieId: r.e.kategorieId, kategorieName: r.kategorieName,
      bezahltAm: r.e.bezahltAm, hatDatei: Boolean(r.e.belegBase64),
    })),
  });
});

app.post("/beleg", async (c) => {
  const body = await bodyLesen(c);
  const lieferant = String(body.lieferant ?? "").trim();
  const datum = String(body.datum ?? "");
  if (!lieferant) return c.json({ ok: false, fehler: "lieferant fehlt." }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) return c.json({ ok: false, fehler: "datum im Format JJJJ-MM-TT nötig." }, 400);

  const brutto = Number(body.brutto);
  if (!Number.isFinite(brutto) || brutto === 0) return c.json({ ok: false, fehler: "brutto (Zahl, negativ wird intern als Ausgabe behandelt — hier positiv) fehlt." }, 400);
  const ustSatz = Number(body.ustSatz ?? 19);
  const netto = body.netto !== undefined ? Number(body.netto) : Math.round((brutto / (1 + ustSatz / 100)) * 100) / 100;
  const ust = Math.round((brutto - netto) * 100) / 100;

  const db = getDb();
  const { incomingInvoices, kategorien, companySettings } = await import("@db/schema");

  // Konto: explizit > Kategorie > Standard-Aufwandskonto
  let konto = body.konto ? String(body.konto) : null;
  let kategorieId: number | null = null;
  if (body.kategorieId) {
    const kat = await db.query.kategorien.findFirst({ where: eq(kategorien.id, Number(body.kategorieId)) });
    if (!kat) return c.json({ ok: false, fehler: "Kategorie nicht gefunden." }, 404);
    kategorieId = kat.id;
    if (!konto && kat.konto) konto = kat.konto;
  }
  if (!konto) {
    const s = await db.query.companySettings.findFirst({ where: eq(companySettings.id, 1) });
    konto = s?.aufwandskontoDefault ?? (s?.datevKontenrahmen === "SKR04" ? "6305" : "4900");
  }

  const nummer = String(body.nummer ?? `BELEG-${datum.replaceAll("-", "")}-${Math.random().toString(36).slice(2, 8)}`);
  const [{ id }] = await db
    .insert(incomingInvoices)
    .values({
      lieferantName: lieferant,
      lieferantKennung: body.lieferantKennung ? String(body.lieferantKennung) : null,
      nummer,
      rechnungsdatum: datum,
      faelligkeitsdatum: body.faelligkeitsdatum ? String(body.faelligkeitsdatum) : null,
      netto: netto.toFixed(2),
      ust: ust.toFixed(2),
      brutto: brutto.toFixed(2),
      konto,
      gegenkonto: null,
      kategorieId,
      belegBase64: body.belegBase64 ? String(body.belegBase64) : null,
      belegMime: body.belegMime ? String(body.belegMime) : null,
      bemerkung: body.bemerkung ? String(body.bemerkung) : "Per Agent-API (Kimi Claw) angelegt",
    })
    .$returningId();

  // Optional: direkt mit Bankbuchung verknüpfen (Beleg = bezahlt markiert)
  let verknuepft: number | null = null;
  if (body.bankbuchungId) {
    const { zuordneIntern } = await import("./bankTransaktionenRouter");
    try {
      await zuordneIntern(Number(body.bankbuchungId), "eingang", id);
      verknuepft = Number(body.bankbuchungId);
    } catch (e) {
      await audit("beleg_angelegt_verknuepfung_fehlgeschlagen", { id, bankbuchungId: body.bankbuchungId, fehler: e instanceof Error ? e.message : String(e) });
      return c.json({ ok: true, id, nummer, verknuepft: null, hinweis: `Beleg angelegt, Bank-Verknüpfung fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  await audit("beleg_angelegt", { id, lieferant, brutto, kategorieId, verknuepft });
  return c.json({ ok: true, id, nummer, lieferant, brutto: brutto.toFixed(2), konto, kategorieId, verknuepft });
});

app.get("/beleg/:id/datei", async (c) => {
  const id = Number(c.req.param("id"));
  const { incomingInvoices } = await import("@db/schema");
  const e = await getDb().query.incomingInvoices.findFirst({ where: eq(incomingInvoices.id, id) });
  if (!e) return c.json({ ok: false, fehler: "Beleg nicht gefunden." }, 404);
  if (!e.belegBase64) return c.json({ ok: false, fehler: "Kein Beleg-Dokument hinterlegt." }, 404);
  return c.json({ ok: true, mime: e.belegMime ?? "application/octet-stream", base64: e.belegBase64 });
});

// ── Banking-Cleanup: Löschen, Import, Historie, Status ─────────────────────
app.delete("/bankbuchung/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const { bankTransaktionen } = await import("@db/schema");
  const db = getDb();
  const t = await db.query.bankTransaktionen.findFirst({ where: eq(bankTransaktionen.id, id) });
  if (!t) return c.json({ ok: false, fehler: "Buchung nicht gefunden." }, 404);
  if (t.status === "zugeordnet" || t.invoiceId || t.incomingInvoiceId) {
    return c.json({ ok: false, fehler: "Zugeordnete/verbuchte Buchungen bleiben unangetastet (GoBD) — erst Zuordnung lösen." }, 409);
  }
  await db.delete(bankTransaktionen).where(eq(bankTransaktionen.id, id));
  await audit("buchung_geloescht", { id, name: t.name, betrag: t.betrag });
  return c.json({ ok: true, geloescht: id });
});

app.post("/bankbuchungen/loeschen", async (c) => {
  const body = await bodyLesen(c);
  const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(Number.isFinite) : [];
  if (ids.length === 0) return c.json({ ok: false, fehler: "ids fehlt: [1,2,3]" }, 400);
  const { bankTransaktionen } = await import("@db/schema");
  const db = getDb();
  let geloescht = 0;
  const uebersprungen: number[] = [];
  for (const id of ids) {
    const t = await db.query.bankTransaktionen.findFirst({ where: eq(bankTransaktionen.id, id) });
    if (!t || t.status === "zugeordnet" || t.invoiceId || t.incomingInvoiceId) {
      uebersprungen.push(id);
      continue;
    }
    await db.delete(bankTransaktionen).where(eq(bankTransaktionen.id, id));
    geloescht++;
  }
  await audit("buchungen_geloescht", { geloescht, uebersprungen });
  return c.json({ ok: true, geloescht, uebersprungen });
});

app.post("/bankbuchung/:id/status", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await bodyLesen(c);
  const status = String(body.status ?? "");
  if (!["offen", "ignoriert"].includes(status)) return c.json({ ok: false, fehler: "status: offen|ignoriert" }, 400);
  const { bankTransaktionen } = await import("@db/schema");
  const db = getDb();
  const t = await db.query.bankTransaktionen.findFirst({ where: eq(bankTransaktionen.id, id) });
  if (!t) return c.json({ ok: false, fehler: "Buchung nicht gefunden." }, 404);
  if (t.status === "zugeordnet") return c.json({ ok: false, fehler: "Zugeordnete Buchung — erst Zuordnung lösen." }, 409);
  await db
    .update(bankTransaktionen)
    .set({ status: status as "offen" | "ignoriert" })
    .where(eq(bankTransaktionen.id, id));
  await audit("buchung_status", { id, status });
  return c.json({ ok: true, id, status });
});

// ── Buchung bearbeiten (Text-Felder; Beträge bleiben unverändert) ──────────
app.put("/bankbuchung/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await bodyLesen(c);
  const { bankTransaktionen } = await import("@db/schema");
  const db = getDb();
  const t = await db.query.bankTransaktionen.findFirst({ where: eq(bankTransaktionen.id, id) });
  if (!t) return c.json({ ok: false, fehler: "Buchung nicht gefunden." }, 404);
  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) patch.name = String(body.name).slice(0, 255);
  if (body.zweck !== undefined) patch.zweck = body.zweck === null ? null : String(body.zweck);
  if (body.bemerkung !== undefined) patch.bemerkung = body.bemerkung === null ? null : String(body.bemerkung).slice(0, 500);
  if (Object.keys(patch).length === 0) return c.json({ ok: false, fehler: "Nichts zu ändern (name/zweck/bemerkung)." }, 400);
  await db.update(bankTransaktionen).set(patch).where(eq(bankTransaktionen.id, id));
  await audit("buchung_bearbeitet", { id, ...patch });
  return c.json({ ok: true, id });
});

// ── Buchung splitten (Teilbeträge einzeln zuordnen/kategorisieren) ─────────
app.post("/bankbuchung/:id/split", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await bodyLesen(c);
  const teile = Array.isArray(body.teile) ? body.teile : [];
  if (teile.length < 2) return c.json({ ok: false, fehler: "teile fehlt (mindestens 2): [{betrag, kategorieId?, name?, bemerkung?}]" }, 400);
  const { bankTransaktionen, kategorien } = await import("@db/schema");
  const { createHash } = await import("node:crypto");
  const db = getDb();
  const t = await db.query.bankTransaktionen.findFirst({ where: eq(bankTransaktionen.id, id) });
  if (!t) return c.json({ ok: false, fehler: "Buchung nicht gefunden." }, 404);
  if (t.status === "zugeordnet") return c.json({ ok: false, fehler: "Zugeordnete Buchung — erst Zuordnung lösen, dann splitten." }, 409);

  const summeTeile = teile.reduce((a: number, x: Record<string, unknown>) => a + Number(x.betrag ?? 0), 0);
  const original = Number(t.betrag);
  if (Math.abs(summeTeile - original) > 0.005) {
    return c.json({ ok: false, fehler: `Teilsumme ${summeTeile.toFixed(2)} ≠ Buchungsbetrag ${original.toFixed(2)} — Teile müssen die Summe exakt decken.` }, 400);
  }
  // Kategorien validieren
  for (const x of teile as Record<string, unknown>[]) {
    if (x.kategorieId) {
      const kat = await db.query.kategorien.findFirst({ where: eq(kategorien.id, Number(x.kategorieId)) });
      if (!kat) return c.json({ ok: false, fehler: `Kategorie ${String(x.kategorieId)} nicht gefunden.` }, 404);
    }
  }

  const neueIds: number[] = [];
  for (const [i, x] of (teile as Record<string, unknown>[]).entries()) {
    const betrag = Number(x.betrag);
    const name = x.name ? String(x.name).slice(0, 255) : `${t.name} (Teil ${i + 1}/${teile.length})`;
    const hash = createHash("sha256")
      .update(`${t.bankAccountId}|split|${id}|${i}|${betrag.toFixed(2)}`)
      .digest("hex")
      .slice(0, 32);
    const [{ id: neuId }] = await db
      .insert(bankTransaktionen)
      .values({
        bankAccountId: t.bankAccountId,
        importId: t.importId,
        datum: t.datum,
        name,
        zweck: t.zweck,
        betrag: betrag.toFixed(2),
        gebuehr: null,
        saldoNach: null,
        hash,
        kategorieId: x.kategorieId ? Number(x.kategorieId) : t.kategorieId,
        bemerkung: x.bemerkung ? String(x.bemerkung).slice(0, 500) : `Split aus #${id}`,
        status: "offen",
      })
      .$returningId();
    neueIds.push(neuId);
  }
  // Original bleibt als ignoriertes Archiv erhalten (Nachvollziehbarkeit)
  await db
    .update(bankTransaktionen)
    .set({ status: "ignoriert", bemerkung: `Gesplittet in ${teile.length} Teile (${neueIds.join(", ")})` })
    .where(eq(bankTransaktionen.id, id));
  await audit("buchung_gesplittet", { id, teile: neueIds });
  return c.json({ ok: true, originalIgnoriert: id, teile: neueIds });
});

// ── Beleg: Datei nachträglich hochladen ─────────────────────────────────────
app.post("/beleg/:id/upload", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await bodyLesen(c);
  const { incomingInvoices } = await import("@db/schema");
  const db = getDb();
  const e = await db.query.incomingInvoices.findFirst({ where: eq(incomingInvoices.id, id) });
  if (!e) return c.json({ ok: false, fehler: "Beleg nicht gefunden." }, 404);
  if (!body.belegBase64) return c.json({ ok: false, fehler: "belegBase64 fehlt." }, 400);
  await db
    .update(incomingInvoices)
    .set({
      belegBase64: String(body.belegBase64),
      belegMime: body.belegMime ? String(body.belegMime) : "application/pdf",
    })
    .where(eq(incomingInvoices.id, id));
  await audit("beleg_upload", { id });
  return c.json({ ok: true, id, mime: body.belegMime ?? "application/pdf" });
});

// ── Rechnung: Zahlung registrieren + Stornieren ────────────────────────────
app.post("/rechnung/:id/zahlung", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await bodyLesen(c);
  const db = getDb();
  const r = await db.query.invoices.findFirst({ where: eq(invoices.id, id) });
  if (!r) return c.json({ ok: false, fehler: "Rechnung nicht gefunden." }, 404);
  if (r.status === "entwurf") return c.json({ ok: false, fehler: "Entwurf — erst finalisieren." }, 409);
  const betrag = body.betrag ? Number(body.betrag) : Number(r.brutto) - Number(r.bezahltBetrag);
  const datum = body.datum && /^\d{4}-\d{2}-\d{2}$/.test(String(body.datum)) ? String(body.datum) : heute();
  await db
    .update(invoices)
    .set({
      bezahltBetrag: (Number(r.bezahltBetrag) + betrag).toFixed(2),
      bezahltAm: datum,
    })
    .where(eq(invoices.id, id));
  await audit("rechnung_zahlung", { id, betrag, datum });
  return c.json({ ok: true, id, zugebucht: betrag, datum });
});

app.post("/rechnung/:id/stornieren", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await bodyLesen(c);
  const db = getDb();
  const r = await db.query.invoices.findFirst({ where: eq(invoices.id, id), with: { items: true } });
  if (!r) return c.json({ ok: false, fehler: "Rechnung nicht gefunden." }, 404);
  if (r.status !== "finalisiert") return c.json({ ok: false, fehler: "Nur finalisierte Rechnungen können storniert werden (GoBD: Gutschrift statt Löschung)." }, 409);
  // Storno = Gutschrift über die produktionserprobte Route
  const { creditNotes, creditNoteItems } = await import("@db/schema");
  const { nextNumber, formatCreditNoteNumber } = await import("./queries/invoicing");
  const nummer = await db.transaction(async (tx) => {
    // Exakt der UI-Fluss: Gutschrift mit positiven Werten, dann finalisieren
    const [{ id: gId }] = await tx
      .insert(creditNotes)
      .values({
        invoiceId: r.id,
        datum: heute(),
        grund: body.grund ? String(body.grund) : "Storno per Agent-API",
        bankAccountId: r.bankAccountId,
        kundeName: r.kundeName,
        kundeZusatz: r.kundeZusatz,
        kundeStrasse: r.kundeStrasse,
        kundePlz: r.kundePlz,
        kundeOrt: r.kundeOrt,
        kundeLand: r.kundeLand,
        netto: r.netto,
        ust: r.ust,
        brutto: r.brutto,
      })
      .$returningId();
    await tx.insert(creditNoteItems).values(
      r.items.map((it) => ({
        creditNoteId: gId,
        position: it.position,
        bezeichnung: it.bezeichnung,
        beschreibung: it.beschreibung,
        menge: it.menge,
        einheit: it.einheit,
        einzelpreis: it.einzelpreis,
        ustSatz: it.ustSatz,
      })),
    );
    // Finalisieren (Nummernkreis + Snapshot der Originalrechnung) + Storno-Status
    const n = await nextNumber(tx, "credit_note", 0);
    const nr = formatCreditNoteNumber(n);
    await tx
      .update(creditNotes)
      .set({ nummer: nr, status: "finalisiert", finalizedAt: new Date(), firmenSnapshot: r.firmenSnapshot })
      .where(eq(creditNotes.id, gId));
    await tx
      .update(invoices)
      .set({ status: "storniert" })
      .where(eq(invoices.id, id));
    return nr;
  });
  await audit("rechnung_storniert", { id, gutschrift: nummer });
  return c.json({ ok: true, storniert: id, gutschrift: nummer });
});

// ── Kunde lesen/aktualisieren ───────────────────────────────────────────────
app.get("/kunde/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const k = await getDb().query.customers.findFirst({ where: eq(customers.id, id) });
  if (!k) return c.json({ ok: false, fehler: "Kunde nicht gefunden." }, 404);
  const { ladeSynonymKarte, agentName } = await import("./lib/pseudonym");
  const karte = await ladeSynonymKarte();
  return c.json({
    id: k.id,
    name: agentName(karte, k.id, k.name),
    ...(karte.aktiv ? { ort: k.ort } : { zusatz: k.zusatz, strasse: k.strasse, plz: k.plz, ort: k.ort, email: k.email }),
    land: k.land,
    zahlungszielTage: k.zahlungszielTage,
  });
});

app.put("/kunde/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await bodyLesen(c);
  const db = getDb();
  const k = await db.query.customers.findFirst({ where: eq(customers.id, id) });
  if (!k) return c.json({ ok: false, fehler: "Kunde nicht gefunden." }, 404);
  const patch: Record<string, unknown> = {};
  for (const feld of ["name", "zusatz", "strasse", "plz", "ort", "land", "email", "kundennummer", "zahlungszielTage", "notizen"] as const) {
    if (body[feld] !== undefined) patch[feld] = body[feld] === null ? null : body[feld];
  }
  if (Object.keys(patch).length === 0) return c.json({ ok: false, fehler: "Nichts zu ändern." }, 400);
  await db.update(customers).set(patch).where(eq(customers.id, id));
  await audit("kunde_geaendert", { id, felder: Object.keys(patch) });
  return c.json({ ok: true, id });
});

// ── Statistik & UStVA ───────────────────────────────────────────────────────
app.get("/statistik/ausgaben", async (c) => {
  const jahr = c.req.query("jahr") ?? new Date().toISOString().slice(0, 4);
  const { incomingInvoices, kategorien } = await import("@db/schema");
  const { asc } = await import("drizzle-orm");
  const db = getDb();
  const zeilen = await db
    .select({ e: incomingInvoices, kategorieName: kategorien.name })
    .from(incomingInvoices)
    .leftJoin(kategorien, eq(incomingInvoices.kategorieId, kategorien.id))
    .orderBy(asc(incomingInvoices.rechnungsdatum));
  const imJahr = zeilen.filter((r) => r.e.rechnungsdatum.startsWith(jahr));
  const proMonat = new Map<string, number>();
  const proKategorie = new Map<string, number>();
  for (const r of imJahr) {
    const m = r.e.rechnungsdatum.slice(0, 7);
    proMonat.set(m, (proMonat.get(m) ?? 0) + Number(r.e.brutto));
    const kat = r.kategorieName ?? "(ohne Kategorie)";
    proKategorie.set(kat, (proKategorie.get(kat) ?? 0) + Number(r.e.brutto));
  }
  return c.json({
    jahr,
    gesamtBrutto: imJahr.reduce((a, r) => a + Number(r.e.brutto), 0),
    anzahl: imJahr.length,
    proMonat: [...proMonat.entries()].map(([monat, brutto]) => ({ monat, brutto })),
    proKategorie: [...proKategorie.entries()].map(([kategorie, brutto]) => ({ kategorie, brutto })),
  });
});

app.get("/ustva", async (c) => {
  const monat = c.req.query("monat") ?? new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(monat)) return c.json({ ok: false, fehler: "monat im Format JJJJ-MM nötig." }, 400);
  const { getDb: db2 } = await import("./queries/connection");
  const { invoices, invoiceItems, incomingInvoices } = await import("@db/schema");
  const db = db2();
  const [ausgaben, items, eingehende] = await Promise.all([
    db.select().from(invoices).where(eq(invoices.status, "finalisiert")),
    db.select().from(invoiceItems),
    db.select().from(incomingInvoices),
  ]);
  const imMonat = ausgaben.filter((r) => r.rechnungsdatum.startsWith(monat));
  const ausMap = new Map<number, { basis: number; ust: number }>();
  for (const r of imMonat) {
    const pos = items.filter((it) => it.invoiceId === r.id);
    const saetze = new Set(pos.map((it) => it.ustSatz));
    const satz = saetze.size === 1 ? [...saetze][0] : -1;
    const netto = Number(r.netto);
    const ust = Number(r.brutto) - netto;
    const e = ausMap.get(satz) ?? { basis: 0, ust: 0 };
    e.basis += netto;
    e.ust += ust;
    ausMap.set(satz, e);
  }
  const einMonat = eingehende.filter((r) => r.rechnungsdatum.startsWith(monat));
  const vorMap = new Map<number, { basis: number; ust: number }>();
  for (const r of einMonat) {
    let saetze = new Set<number>();
    try {
      const pos = JSON.parse(r.positionenJson ?? "[]") as { ustSatz: number }[];
      saetze = new Set(pos.map((p) => p.ustSatz));
    } catch { /* egal */ }
    const satz = saetze.size === 1 ? [...saetze][0] : -1;
    const e = vorMap.get(satz) ?? { basis: 0, ust: 0 };
    e.basis += Number(r.netto);
    e.ust += Number(r.ust);
    vorMap.set(satz, e);
  }
  const zuListe = (m: Map<number, { basis: number; ust: number }>) =>
    [...m.entries()].map(([satz, v]) => ({ satz, ...v })).sort((a, b) => b.basis - a.basis);
  const ustGesamt = [...ausMap.values()].reduce((a, v) => a + v.ust, 0);
  const vorGesamt = [...vorMap.values()].reduce((a, v) => a + v.ust, 0);
  return c.json({
    monat,
    ausgangsrechnungen: zuListe(ausMap),
    eingangsrechnungen: zuListe(vorMap),
    umsatzsteuer: ustGesamt,
    vorsteuer: vorGesamt,
    zahllast: ustGesamt - vorGesamt,
  });
});

// ── Mahnung löschen ─────────────────────────────────────────────────────────
app.delete("/mahnung/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const { reminders } = await import("@db/schema");
  await getDb().delete(reminders).where(eq(reminders.id, id));
  await audit("mahnung_geloescht", { id });
  return c.json({ ok: true, geloescht: id });
});

// ── Aliase (Agent denkt in seinen Pfaden — beide führen zum selben Ziel) ────
function weiterleiten(c: { req: { raw: Request } }, von: string, nach: string) {
  const url = new URL(c.req.raw.url);
  url.pathname = url.pathname.replace(von, nach);
  return app.fetch(new Request(url.toString(), c.req.raw));
}

app.post("/bankbuchungen/import", (c) => weiterleiten(c, "/bankbuchungen/import", "/bankimport"));
app.post("/eingangsrechnung", (c) => weiterleiten(c, "/eingangsrechnung", "/beleg"));
app.get("/eingangsrechnungen", (c) => weiterleiten(c, "/eingangsrechnungen", "/belege"));
app.get("/export/datev", (c) => {
  const url = new URL("http://intern/api/agent/datev-export");
  const roh = new Request(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ von: c.req.query("von") ?? "", bis: c.req.query("bis") ?? "" }),
  });
  return app.fetch(roh);
});

app.get("/bankimporte", async (c) => {
  const { bankImporte } = await import("@db/schema");
  const { desc } = await import("drizzle-orm");
  const kontoId = c.req.query("bankAccountId") ? Number(c.req.query("bankAccountId")) : null;
  const db = getDb();
  const rows = await db
    .select()
    .from(bankImporte)
    .where(kontoId ? eq(bankImporte.bankAccountId, kontoId) : undefined)
    .orderBy(desc(bankImporte.createdAt))
    .limit(50);
  return c.json({
    importe: rows.map((r) => ({
      id: r.id, bankAccountId: r.bankAccountId, dateiname: r.dateiname,
      vorlage: r.vorlage, zeilen: r.zeilen, duplikate: r.duplikate,
      summeEin: r.summeEin ? Number(r.summeEin) : null, summeAus: r.summeAus ? Number(r.summeAus) : null,
      erstelltAm: r.createdAt,
    })),
  });
});

app.delete("/bankimport/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const { bankImporte, bankTransaktionen } = await import("@db/schema");
  const { and } = await import("drizzle-orm");
  const db = getDb();
  const zugeordnet = await db
    .select({ id: bankTransaktionen.id })
    .from(bankTransaktionen)
    .where(and(eq(bankTransaktionen.importId, id), eq(bankTransaktionen.status, "zugeordnet")))
    .limit(1);
  if (zugeordnet.length > 0) {
    return c.json({ ok: false, fehler: "Aus diesem Import sind bereits Zahlungen verbucht — Import bleibt (GoBD)." }, 409);
  }
  await db.delete(bankTransaktionen).where(eq(bankTransaktionen.importId, id));
  await db.delete(bankImporte).where(eq(bankImporte.id, id));
  await audit("import_geloescht", { importId: id });
  return c.json({ ok: true, geloescht: id });
});

app.post("/bankimport", async (c) => {
  const body = await bodyLesen(c);
  const bankAccountId = Number(body.bankAccountId);
  if (!bankAccountId) return c.json({ ok: false, fehler: "bankAccountId fehlt." }, 400);
  const dateiname = String(body.dateiname ?? "import");
  const db = getDb();
  const { bankAccounts } = await import("@db/schema");
  const konto = await db.query.bankAccounts.findFirst({ where: eq(bankAccounts.id, bankAccountId) });
  if (!konto) return c.json({ ok: false, fehler: "Bankkonto nicht gefunden." }, 404);

  // PDF (base64) oder CSV (Text) — beide Wege produktionserprobt
  if (body.pdfBase64) {
    const { liesSumUpKontoauszug } = await import("./lib/sumupKontoauszug");
    const { persistiereUndMatche } = await import("./bankTransaktionenRouter");
    const { zeilen, uebersprungen, meta } = await liesSumUpKontoauszug(
      new Uint8Array(Buffer.from(String(body.pdfBase64), "base64")),
    );
    const ergebnis = await persistiereUndMatche(bankAccountId, dateiname, "SumUp Kontoauszug (PDF)", zeilen, uebersprungen);
    await audit("bankimport_pdf", { bankAccountId, importiert: ergebnis.importiert, duplikate: ergebnis.duplikate });
    return c.json({ ok: true, ...ergebnis, auszugMeta: meta });
  }

  const csvText = String(body.csvText ?? "");
  if (!csvText.trim()) return c.json({ ok: false, fehler: "pdfBase64 oder csvText nötig." }, 400);
  const { parseCsv, errate, parseZeilen, parseSumUpVollZeilen, parseSumUpBerichtZeilen, persistiereUndMatche } = await import("./bankTransaktionenRouter");
  const rows = parseCsv(csvText);
  if (rows.length === 0) return c.json({ ok: false, fehler: "Keine Datenzeilen in der CSV gefunden." }, 400);
  const { vorlage, ...mapping } = errate(Object.keys(rows[0]));
  const istVoll = mapping.betrag === "__sumup_voll__";
  const istBericht = mapping.betrag === "__sumup_bericht__";
  const { zeilen, uebersprungen } = istVoll
    ? parseSumUpVollZeilen(rows)
    : istBericht
      ? parseSumUpBerichtZeilen(rows)
      : { zeilen: parseZeilen(rows, mapping), uebersprungen: 0 };
  const ergebnis = await persistiereUndMatche(bankAccountId, dateiname, vorlage, zeilen, uebersprungen);
  await audit("bankimport_csv", { bankAccountId, vorlage, importiert: ergebnis.importiert, duplikate: ergebnis.duplikate });
  return c.json({ ok: true, vorlage, ...ergebnis });
});

// ── Mail: Lesen, Suchen, Versenden, als Beleg ───────────────────────────────
app.get("/mails", async (c) => {
  const { mailMails } = await import("@db/schema");
  const { and, desc, eq, like: driLike, or } = await import("drizzle-orm");
  const { ladeSynonymKarte, maskiereGegenstelle } = await import("./lib/pseudonym");
  const karte = await ladeSynonymKarte();
  const q = c.req.query("q")?.trim();
  const ordner = c.req.query("ordner");
  const limit = Math.min(100, Number(c.req.query("limit") ?? 40));
  const bedingungen = [];
  if (ordner) bedingungen.push(eq(mailMails.ordner, ordner));
  if (c.req.query("nurUngelesene") === "1" || c.req.query("nurUngelesene") === "true") {
    bedingungen.push(eq(mailMails.gelesen, false));
  }
  if (q) {
    const muster = `%${q}%`;
    bedingungen.push(
      or(
        driLike(mailMails.betreff, muster),
        driLike(mailMails.absenderName, muster),
        driLike(mailMails.absenderAdresse, muster),
        driLike(mailMails.textPlain, muster),
      ),
    );
  }
  const rows = await getDb()
    .select()
    .from(mailMails)
    .where(bedingungen.length ? and(...bedingungen) : undefined)
    .orderBy(desc(mailMails.datum), desc(mailMails.id))
    .limit(limit);
  return c.json({
    anzahl: rows.length,
    mails: rows.map((m) => ({
      id: m.id, ordner: m.ordner, betreff: m.betreff,
      absender: maskiereGegenstelle(karte, m.absenderName ?? m.absenderAdresse ?? ""),
      datum: m.datum, gelesen: m.gelesen,
      anzahlAnhaenge: m.anhaenge ? (JSON.parse(m.anhaenge) as unknown[]).length : 0,
    })),
  });
});

app.get("/mail/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const { mailMails } = await import("@db/schema");
  const { ladeSynonymKarte, maskiereGegenstelle } = await import("./lib/pseudonym");
  const karte = await ladeSynonymKarte();
  const m = await getDb().query.mailMails.findFirst({ where: eq(mailMails.id, id) });
  if (!m) return c.json({ ok: false, fehler: "Mail nicht gefunden." }, 404);
  let anhaenge: unknown[] = [];
  try {
    anhaenge = m.anhaenge ? (JSON.parse(m.anhaenge) as unknown[]) : [];
  } catch { /* egal */ }
  return c.json({
    id: m.id, ordner: m.ordner, betreff: m.betreff,
    absender: maskiereGegenstelle(karte, m.absenderName ?? ""),
    absenderAdresse: m.absenderAdresse,
    datum: m.datum, gelesen: m.gelesen,
    textPlain: m.textPlain, textHtml: m.textHtml, anhaenge,
  });
});

app.get("/mail/:id/anhang/:index", async (c) => {
  const mailId = Number(c.req.param("id"));
  const index = Number(c.req.param("index"));
  const { mailMails, postEingang } = await import("@db/schema");
  const { metaLesen } = await import("./lib/mailBeleg");
  const db = getDb();
  const m = await db.query.mailMails.findFirst({ where: eq(mailMails.id, mailId) });
  if (!m) return c.json({ ok: false, fehler: "Mail nicht gefunden." }, 404);
  const meta = metaLesen(m.anhaenge)[index];
  if (!meta) return c.json({ ok: false, fehler: "Anhang nicht gefunden." }, 404);
  if (!meta.postEingangId) return c.json({ ok: false, fehler: "Anhangtyp nur als Metadaten (kein Download)." }, 404);
  const beleg = await db.query.postEingang.findFirst({ where: eq(postEingang.id, meta.postEingangId) });
  if (!beleg?.dateiInhalt) return c.json({ ok: false, fehler: "Anhang-Datei nicht vorhanden." }, 404);
  return c.json({ ok: true, dateiname: beleg.originalname, mime: beleg.mime, base64: beleg.dateiInhalt });
});

app.post("/mail/versenden", async (c) => {
  const stufe = await autonomie();
  if (stufe !== "vollautomatik") {
    return c.json({ ok: false, fehler: "Mail-Versand ist in der Stufe „vorschlag“ gesperrt (Einstellungen → Agent-API → vollautomatik)." }, 403);
  }
  const body = await bodyLesen(c);
  const empfaenger = Array.isArray(body.empfaenger)
    ? body.empfaenger.map(String)
    : String(body.empfaenger ?? "").split(",").map((x) => x.trim());
  if (empfaenger.filter(Boolean).length === 0) return c.json({ ok: false, fehler: "empfaenger fehlt (Array oder kommagetrennt)." }, 400);
  const betreff = String(body.betreff ?? "").trim();
  const text = String(body.text ?? "");
  if (!betreff || !text) return c.json({ ok: false, fehler: "betreff + text nötig." }, 400);
  const { versendeMail } = await import("./lib/mailVersand");
  const r = await versendeMail({
    empfaenger,
    cc: Array.isArray(body.cc) ? body.cc.map(String) : undefined,
    betreff,
    text,
    inReplyTo: body.inReplyTo ? String(body.inReplyTo) : null,
    references: body.references ? String(body.references) : null,
    mitSignatur: body.mitSignatur !== false,
  });
  await audit("mail_versendet", { empfaenger, betreff, erfolg: r.ok, fehler: r.fehler });
  if (!r.ok) return c.json({ ok: false, fehler: `Versand fehlgeschlagen: ${r.fehler}` }, 502);
  return c.json({ ok: true });
});

app.post("/mail/:id/als-beleg", async (c) => {
  const mailId = Number(c.req.param("id"));
  const body = await bodyLesen(c);
  const anhangIndex = body.anhangIndex !== undefined ? Number(body.anhangIndex) : undefined;
  const { alsBelegIntern } = await import("./lib/mailBeleg");
  try {
    const r = await alsBelegIntern(mailId, anhangIndex);
    await audit("mail_als_beleg", { mailId, anhangIndex, belegId: r.belegId });
    return c.json({ ok: true, ...r });
  } catch (e) {
    return c.json({ ok: false, fehler: e instanceof Error ? e.message : String(e) }, 409);
  }
});

// ── DATEV-Export per API ───────────────────────────────────────────────────
app.post("/datev-export", async (c) => {
  const body = await bodyLesen(c);
  const von = String(body.von ?? "");
  const bis = String(body.bis ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(von) || !/^\d{4}-\d{2}-\d{2}$/.test(bis)) {
    return c.json({ ok: false, fehler: "von/bis im Format JJJJ-MM-TT nötig." }, 400);
  }
  const { baueDatevStapel } = await import("./exportRouter");
  const r = await baueDatevStapel(von, bis);
  await audit("datev_export", { von, bis, anzahl: r.anzahlBuchungen });
  return c.json({
    ok: true,
    dateiname: r.dateiname,
    anzahlBuchungen: r.anzahlBuchungen,
    hinweise: r.hinweise,
    csvBase64: Buffer.from(r.csv, "utf8").toString("base64"),
  });
});

export default app;
