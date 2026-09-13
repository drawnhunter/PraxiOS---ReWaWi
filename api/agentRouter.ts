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
  const rows = await db.select().from(invoices).where(eq(invoices.status, "finalisiert"));
  const h = heute();
  const offene = rows
    .filter((r) => Number(r.brutto) - Number(r.bezahltBetrag) > 0.004)
    .map((r) => ({
      id: r.id,
      nummer: r.nummer,
      kunde: r.kundeName,
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
  const rows = await getDb().query.invoices.findMany({
    where: eq(invoices.status, "entwurf"),
    orderBy: [desc(invoices.createdAt)],
  });
  return c.json({
    anzahl: rows.length,
    entwuerfe: rows.map((r) => ({
      id: r.id, kunde: r.kundeName, kundenId: r.customerId,
      netto: Number(r.netto), brutto: Number(r.brutto), datum: r.rechnungsdatum,
    })),
  });
});

app.get("/kunden-ohne-rechnung", async (c) => {
  const tage = Math.max(7, Math.min(365, Number(c.req.query("tage") ?? "30")));
  const schwelle = new Date(Date.now() - tage * 86400000).toISOString().slice(0, 10);
  const db = getDb();
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
    .map((k) => ({ id: k.id, name: k.name, email: k.email, letzteRechnung: letzteJeKunde.get(k.id) ?? null }))
    .sort((a, b) => ((a.letzteRechnung ?? "") < (b.letzteRechnung ?? "") ? -1 : 1));
  return c.json({ tage, anzahl: faellig.length, kunden: faellig });
});

app.get("/mahnungen", async (c) => {
  const db = getDb();
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
        rechnungId: r.id, nummer: r.nummer, kunde: r.kundeName,
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
  const rows = await getDb()
    .select({ t: bankTransaktionen, konto: bankAccounts.bezeichnung })
    .from(bankTransaktionen)
    .leftJoin(bankAccounts, eq(bankTransaktionen.bankAccountId, bankAccounts.id))
    .where(gte(bankTransaktionen.datum, seit))
    .orderBy(asc(bankTransaktionen.datum));
  return c.json({
    tage,
    anzahl: rows.length,
    buchungen: rows.map((r) => ({
      id: r.t.id,
      datum: r.t.datum,
      betrag: Number(r.t.betrag),
      name: r.t.name,
      zweck: r.t.zweck,
      konto: r.konto,
      status: r.t.status,
      quellId: r.t.quellId,
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
  return c.json(t);
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
      name: r.t.name,
      konto: r.konto,
      vorschlag: vorschlag
        ? {
            typ: vorschlag.typ,
            rechnungOderBeleg: vorschlag.nummer,
            kunde: vorschlag.bezeichner,
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
  return c.json({
    anzahl: rows.length,
    kunden: rows.map((k) => ({
      id: k.id, name: k.name, zusatz: k.zusatz, strasse: k.strasse,
      plz: k.plz, ort: k.ort, land: k.land, email: k.email,
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
  return c.json({
    id: r.id, nummer: r.nummer, status: r.status,
    kunde: r.kundeName, kundenId: r.customerId,
    rechnungsdatum: r.rechnungsdatum, faelligkeitsdatum: r.faelligkeitsdatum,
    netto: Number(r.netto), ust: Number(r.ust), brutto: Number(r.brutto),
    bezahltBetrag: Number(r.bezahltBetrag),
    positionen: r.items.map((it) => ({
      position: it.position, bezeichnung: it.bezeichnung, beschreibung: it.beschreibung,
      menge: Number(it.menge), einheit: it.einheit, einzelpreis: Number(it.einzelpreis), ustSatz: it.ustSatz,
    })),
  });
});

/** Body tolerant lesen: JSON (application/json) ODER Formular (urlencoded). */
async function bodyLesen(c: { req: { json: () => Promise<Record<string, unknown>>; parseBody: () => Promise<Record<string, unknown>> } }): Promise<Record<string, unknown>> {
  try {
    return await c.req.json();
  } catch {
    try {
      return await c.req.parseBody();
    } catch {
      return {};
    }
  }
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
  await audit("kunde_angelegt", { id, name });
  return c.json({ ok: true, id, name });
});

app.post("/rechnung-entwurf", async (c) => {
  const body = await bodyLesen(c);
  const db = getDb();

  // Kunde: per ID oder per Namen (Fuzzy)
  let kunde: typeof customers.$inferSelect | undefined;
  if (body.kundenId) {
    kunde = await db.query.customers.findFirst({ where: eq(customers.id, Number(body.kundenId)) });
  } else if (body.kunde) {
    const alle = await db.select().from(customers);
    const t = besterTreffer(alle, String(body.kunde), (k) => k.name);
    kunde = t?.treffer;
  }
  if (!kunde) return c.json({ fehler: "Kunde nicht gefunden (kundenId oder kunde als Name angeben)." }, 404);

  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) return c.json({ fehler: "items fehlt: [{bezeichnung, menge?, einzelpreis, ustSatz?}]" }, 400);
  const positionen = items.map((it: Record<string, unknown>, i: number) => ({
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
  await audit("rechnung_entwurf", { id, kunde: kunde.name, positionen: positionen.length, brutto: centToDecimal(totals.bruttoCent) });
  return c.json({ ok: true, id, kunde: kunde.name, brutto: centToDecimal(totals.bruttoCent), hinweis: "Entwurf angelegt — Freigabe erfolgt durch einen Menschen (oder Vollautomatik in Einstellungen)." });
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

export default app;
