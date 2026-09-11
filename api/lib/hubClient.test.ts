import { describe, expect, it } from "vitest";
import { baueHeartbeat } from "./hubClient";

// Hub-Vertrag (Bus #18): optionale Felder werden WEGGELASSEN, nicht null —
// zod am Hub lehnt null mit 400 ab (die PaWaWi-Falle).
describe("Hub-Heartbeat-Payload", () => {
  const basis = {
    schluessel: "ps_test123",
    diskProzent: 42,
    uptimeSek: 600,
    letztesBackup: null,
    backupGroesseMb: null,
    fehler24h: 0,
  };

  it("lässt leere Backup-Felder komplett weg", () => {
    const h = baueHeartbeat(basis);
    expect(h).not.toHaveProperty("letztesBackup");
    expect(h).not.toHaveProperty("backupGroesseMb");
    expect(h.schluessel).toBe("ps_test123");
    expect(h.diskProzent).toBe(42);
    expect(h.fehler24h).toBe(0);
  });

  it("sendet Backup-Felder, wenn Werte da sind", () => {
    const h = baueHeartbeat({
      ...basis,
      letztesBackup: "2026-09-01T03:00:00.000Z",
      backupGroesseMb: 12.4,
    });
    expect(h.letztesBackup).toBe("2026-09-01T03:00:00.000Z");
    expect(h.backupGroesseMb).toBe(12.4);
  });

  it("sendet keine null-Werte — nie", () => {
    const h = baueHeartbeat({ ...basis, diskProzent: null });
    // diskProzent ist im Vertrag Pflicht (number) — wird bewusst mitgeschickt
    expect(Object.values(h).every((v) => v !== null || v === h.diskProzent)).toBe(true);
  });
});
