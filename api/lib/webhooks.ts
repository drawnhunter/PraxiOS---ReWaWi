// ── Webhooks: Ereignis → URL (fire-and-forget, blockiert nie den Aufrufer) ──
import { eq, and } from "drizzle-orm";
import { getDb } from "../queries/connection";

export type WebhookEreignis = "mail.neu" | "bankbuchung.neu";

/** Alle aktiven Hooks eines Ereignisses aufrufen (POST JSON, 5s Timeout). */
export function feuereWebhooks(ereignis: WebhookEreignis, daten: Record<string, unknown>): void {
  // bewusst nicht awaited — Fehler werden nur gezählt
  void (async () => {
    try {
      const { webhooks } = await import("@db/schema");
      const hooks = await getDb()
        .select()
        .from(webhooks)
        .where(and(eq(webhooks.ereignis, ereignis), eq(webhooks.aktiv, true)));
      for (const h of hooks) {
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 5000);
          const res = await fetch(h.url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ereignis, zeit: new Date().toISOString(), ...daten }),
            signal: ctrl.signal,
          });
          clearTimeout(t);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
        } catch {
          await getDb()
            .update(webhooks)
            .set({ fehler: h.fehler + 1 })
            .where(eq(webhooks.id, h.id))
            .catch(() => undefined);
        }
      }
    } catch { /* Hook-System darf nie crashen */ }
  })();
}
