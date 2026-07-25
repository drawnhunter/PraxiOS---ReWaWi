# Mitwirken / Contributing

Danke für dein Interesse an ReWaWi! 🎉

## Setup

```bash
cp .env.example .env   # DATABASE_URL + APP_SECRET setzen
npm install
npm run dev            # oder: docker compose up --build
```

## Konventionen

- **Sprache:** UI-Texte und Kommentare auf Deutsch, Code/Bezeichner auf Englisch (außer Fachbegriffe)
- **Backend:** tRPC-Router in `api/` (ein Router pro Fachgebiet), DB-Schema in `db/schema.ts`
- **DB-Änderungen:** IMMER zusätzlich in `api/migrate.ts` eintragen (Selbst-Migration für Bestandsinstallationen) UND `schema.sql` für Frischinstallationen aktualisieren
- **GoBD:** finalisierte Belege sind unveränderbar; Korrekturen nur per Storno/Gutschrift; Nummern erst bei Finalisierung
- **Vor dem PR:** `npx tsc -b` und `npm run build` müssen durchlaufen

## Pull Requests

- Klein und fokussiert bleiben; ein Thema pro PR
- Beschreibe kurz: Was? Warum? Wie getestet?
- Keine persönlichen/echten Daten in Code, Tests oder Beispielen

## Lizenz-Hinweis (Dual-Licensing)

ReWaWi steht unter der AGPL-3.0. Mit dem Einreichen eines Beitrags erklärst du
dich einverstanden, dass dein Beitrag unter derselben Lizenz veröffentlicht
und im Rahmen von Dual-Licensing auch kommerziell lizenziert werden darf
(Drittlizenz). Du behältst dein Urheberrecht.
