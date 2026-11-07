#!/usr/bin/env node
// Vollständigkeits-Check: Jede app.*-Route aus api/agentRouter.ts muss in
// docs/agent-api.md dokumentiert sein (Pfad wörtlich, z. B. /beleg/:id).
// Aufruf: node scripts/pruefeDoku.mjs   (Repo-Wurzel; Exit 1 = Pfade fehlen)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const wurzel = join(dirname(fileURLToPath(import.meta.url)), "..");
const router = readFileSync(join(wurzel, "api", "agentRouter.ts"), "utf8");
const doku = readFileSync(join(wurzel, "docs", "agent-api.md"), "utf8");

const ROUTEN_RE = /app\.(get|post|patch|put|delete)\(\s*"([^"]+)"/g;
const gefunden = new Map(); // "METHODE /pfad" -> zeile
let m;
while ((m = ROUTEN_RE.exec(router)) !== null) {
  const methode = m[1].toUpperCase();
  const pfad = m[2];
  const zeile = router.slice(0, m.index).split("\n").length;
  gefunden.set(`${methode} ${pfad}`, { methode, pfad, zeile });
}

const fehlend = [];
for (const { methode, pfad, zeile } of gefunden.values()) {
  // Pfad muss wörtlich vorkommen; idealerweise zusammen mit der Methode.
  const hatPfad = doku.includes(pfad);
  const hatMethodeUndPfad = new RegExp(
    `(^|[^\\w])${methode}\\s+[^\\n]*${pfad.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
    "m",
  ).test(doku);
  if (!hatPfad || !hatMethodeUndPfad) {
    fehlend.push(`${methode} ${pfad} (agentRouter.ts:${zeile})${hatPfad ? " — Pfad da, aber Methode fehlt/falsch" : ""}`);
  }
}

console.log(`Geprüft: ${gefunden.size} Routen aus api/agentRouter.ts gegen docs/agent-api.md`);
if (fehlend.length > 0) {
  console.error(`\nFEHLEND (${fehlend.length}):`);
  for (const f of fehlend) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("OK — alle Routen sind dokumentiert.");
