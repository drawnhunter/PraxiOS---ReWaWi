import { describe, expect, it } from "vitest";
import { KonfliktFehler, pruefeVersion } from "./konflikt";

describe("Optimistic Locking (v1.21.8)", () => {
  const alt = new Date("2026-11-08T10:00:00Z");

  it("gleiche Version → kein Konflikt", () => {
    expect(() => pruefeVersion({ updatedAt: alt }, alt.toISOString(), false)).not.toThrow();
  });

  it("Server neuer als Formular-Version → KONFLIKT", () => {
    const neuer = new Date("2026-11-08T10:05:00Z");
    expect(() => pruefeVersion({ updatedAt: neuer }, alt.toISOString(), false)).toThrow(KonfliktFehler);
    expect(() => pruefeVersion({ updatedAt: neuer }, alt.toISOString(), false)).toThrow(/^KONFLIKT:/);
  });

  it("erzwingen überspringt die Prüfung", () => {
    const neuer = new Date("2026-11-08T10:05:00Z");
    expect(() => pruefeVersion({ updatedAt: neuer }, alt.toISOString(), true)).not.toThrow();
  });

  it("fehlende Version (Legacy-Clients) bleibt erlaubt", () => {
    expect(() => pruefeVersion({ updatedAt: new Date() }, undefined, false)).not.toThrow();
    expect(() => pruefeVersion({ updatedAt: new Date() }, null, false)).not.toThrow();
  });

  it("1 s Toleranz für Sekundenpräzision", () => {
    const knapp = new Date(alt.getTime() + 500);
    expect(() => pruefeVersion({ updatedAt: knapp }, alt.toISOString(), false)).not.toThrow();
    const darueber = new Date(alt.getTime() + 2000);
    expect(() => pruefeVersion({ updatedAt: darueber }, alt.toISOString(), false)).toThrow(KonfliktFehler);
  });

  it("updatedAt als String (drizzle-Serialisierung) funktioniert", () => {
    expect(() => pruefeVersion({ updatedAt: alt.toISOString() }, alt.toISOString(), false)).not.toThrow();
  });
});
