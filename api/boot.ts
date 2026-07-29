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

  // Kontenrahmen/Kategorien einmalig vorbefuellen + E-Mail-Abruf starten
  try {
    const { seedKontierung } = await import("./kontierungRouter");
    await seedKontierung();
  } catch (e) {
    console.error("[seed] Kontierung fehlgeschlagen:", e);
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
