import { describe, expect, it } from "vitest";
import { NEUE_SPALTEN } from "./migrate";

/**
 * Statische Ordnungs-Wache für die Spalten-Migration.
 * Hintergrund: Ein AFTER-Verweis auf eine Spalte, die erst später in
 * derselben Liste angelegt wird, lässt das ALTER isoliert scheitern —
 * danach brechen alle SELECTs auf die Tabelle ("Unknown column").
 * Dieser Test fängt das zur Build-Zeit ab. (Muster aus Dr.PaWaWi v1.7.2)
 */
describe("NEUE_SPALTEN Ordnung", () => {
  it("keine Spalte doppelt", () => {
    const gesehen = new Set<string>();
    for (const s of NEUE_SPALTEN) {
      const key = `${s.tabelle}.${s.spalte}`;
      expect(gesehen.has(key), `Doppel-Anlage: ${key}`).toBe(false);
      gesehen.add(key);
    }
  });

  it("AFTER-Ziele derselben Tabelle stehen vorher in der Liste", () => {
    NEUE_SPALTEN.forEach((s, index) => {
      const match = /AFTER\s+(\w+)/i.exec(s.ddl);
      if (!match) return;
      const ziel = match[1];
      const zielIndex = NEUE_SPALTEN.findIndex(
        (x) => x.tabelle === s.tabelle && x.spalte === ziel,
      );
      if (zielIndex === -1) return; // Ziel ist Basis-Spalte der Tabelle — ok
      expect(
        zielIndex < index,
        `${s.tabelle}.${s.spalte} verweist AFTER ${ziel}, das erst später kommt`,
      ).toBe(true);
    });
  });

  it("keine AFTER-Selbstreferenz", () => {
    for (const s of NEUE_SPALTEN) {
      const match = /AFTER\s+(\w+)/i.exec(s.ddl);
      if (match) expect(match[1], `Selbstreferenz: ${s.spalte}`).not.toBe(s.spalte);
    }
  });
});
