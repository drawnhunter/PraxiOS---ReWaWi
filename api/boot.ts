import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { eq } from "drizzle-orm";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";
import { getDb } from "./queries/connection";
import { companySettings } from "@db/schema";
import { baueZahlungszieleIcs } from "./lib/ics";

const app = new Hono<{ Bindings: HttpBindings }>();

app.use(bodyLimit({ maxSize: 50 * 1024 * 1024 }));

// Oeffentlicher ICS-Feed (geheimes Token in der URL) — Zahlungsziele-Kalender
app.get("/ics/kalender.ics", async (c) => {
  const token = c.req.query("token") ?? "";
  if (token.length < 20) return c.text("Ungültiges Token.", 403);
  const einst = await getDb().query.companySettings.findFirst({
    where: eq(companySettings.id, 1),
  });
  if (!einst?.icsToken || einst.icsToken !== token) return c.text("Ungültiges Token.", 403);
  const { termine } = await import("@db/schema");
  const { asc } = await import("drizzle-orm");
  const { baueKalenderIcs } = await import("./kalenderRouter");
  const rows = await getDb().select().from(termine).orderBy(asc(termine.datum)).limit(2000);
  const { ladeQuellEintraege } = await import("./kalenderRouter");
  const quellen = await ladeQuellEintraege("2000-01-01", "2099-12-31");
  return c.body(baueKalenderIcs(rows, quellen), 200, { "Content-Type": "text/calendar; charset=utf-8" });
});

app.get("/ics/zahlungsziele.ics", async (c) => {
  const token = c.req.query("token") ?? "";
  if (token.length < 20) return c.text("Ungültiges Token.", 403);
  const einst = await getDb().query.companySettings.findFirst({
    where: eq(companySettings.id, 1),
  });
  if (!einst?.icsToken || einst.icsToken !== token) return c.text("Ungültiges Token.", 403);
  const ics = await baueZahlungszieleIcs();
  return c.body(ics, 200, { "Content-Type": "text/calendar; charset=utf-8" });
});

// Agent-API (Kimi Claw): REST mit Bearer-Token, unabhängig von der Session
try {
  const { default: agentRouter } = await import("./agentRouter");
  app.route("/api/agent", agentRouter);
  console.log("[agent] API unter /api/agent aktiv (Bearer-Token in Einstellungen)");
} catch (e) {
  console.error("[agent] Router-Mount fehlgeschlagen:", e);
}

// Modul-Gate: deaktivierte Module antworten mit 403 (vor dem tRPC-Handler)
app.use("/api/trpc/*", async (c, next) => {
  const { modulFuerRouter, modulAktiv } = await import("./lib/module");
  const pfad = c.req.path.replace(/^\/api\/trpc\//, "").split("?")[0];
  // Batching: Pfade sind kommagetrennt (zeit.a,zeit.b)
  const routerNamen = [...new Set(pfad.split(",").map((x) => x.split(".")[0]))];
  for (const name of routerNamen) {
    const def = modulFuerRouter(name);
    if (def && !(await modulAktiv(def.id))) {
      return c.json(
        [{ error: { message: `Modul „${def.titel}" ist deaktiviert (Einstellungen → Module).`, code: -32403, data: { code: "FORBIDDEN", httpStatus: 403 } } }],
        403,
      );
    }
  }
  return next();
});

app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});
app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

export default app;

if (env.isProduction) {
  // Fehlende DB-Spalten aus aelteren Versionen automatisch nachziehen
  try {
    const { migriereFehlendeSpalten } = await import("./migrate");
    await migriereFehlendeSpalten();
  } catch (e) {
    console.error("[migrate] fehlgeschlagen:", e);
  }

  // Nummernkreise selbstheilend anheben (nie absenken; schützt vor
  // ER_DUP_ENTRY nach Altbestand-Importen oder Reparatur-Eingriffen)
  try {
    const { heileNummernkreise } = await import("./lib/nummernkreisHeilung");
    await heileNummernkreise();
  } catch (e) {
    console.error("[nummernkreise] Selbstheilung fehlgeschlagen:", e);
  }

  // Kontenrahmen/Kategorien einmalig vorbefuellen + E-Mail-Abruf starten
  try {
    const { seedKontierung } = await import("./kontierungRouter");
    await seedKontierung();
  } catch (e) {
    console.error("[seed] Kontierung fehlgeschlagen:", e);
  }
  // Hub-Fernverwaltung (Pull): Heartbeat + Befehle — nur mit Support-Schluessel
  try {
    const { starteHubClient } = await import("./lib/hubClient");
    starteHubClient();
  } catch (e) {
    console.error("[hub] Client-Start fehlgeschlagen:", e);
  }
  try {
    const { starteImapDienst } = await import("./imapDienst");
    starteImapDienst();
  } catch (e) {
    console.error("[imap] Dienst-Start fehlgeschlagen:", e);
  }

  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);

  const port = parseInt(process.env.PORT || "3000");
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}
