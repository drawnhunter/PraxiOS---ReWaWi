import { getDb } from "../api/queries/connection";
import { numberSequences } from "./schema";

// Minimal-Seed: nur die Nummernkreise anlegen.
// Firmendaten, Bankkonten und Benutzer werden bei der Ersteinrichtung
// (Wizard) bzw. in den Einstellungen eingetragen - hier gibt es
// bewusst keine vorbelegten Daten.
async function seed() {
  const db = getDb();
  console.log("Seeding database...");

  const jahr = new Date().getFullYear();
  await db
    .insert(numberSequences)
    .values([
      { typ: "invoice", jahr, letzteNummer: 0 },
      { typ: "credit_note", jahr: 0, letzteNummer: 0 },
      { typ: "offer", jahr, letzteNummer: 0 },
    ])
    .onDuplicateKeyUpdate({ set: { letzteNummer: 0 } });

  console.log("Done.");
  process.exit(0);
}

seed();
