# Änderungsprotokoll

Format: [Keep a Changelog](https://keepachangelog.com/de/) · Versionierung: SemVer.

## [1.1.0] — 2026-07-26

### Neu

- **In-App-Support:** Support-Button in der Übersicht öffnet einen Dialog
  (Frage/Problem/Idee/Fehler) mit Versand per SMTP an den PraxiOS-Support;
  Hinweis auf Support-Pakete integriert
- **Fehler-Melder:** Bei Abstürzen erscheint ein Fenster mit
  „Fehler melden / Ohne Meldung neu laden" (inkl. transparenter Vorschau der
  übertragenen Daten); nicht-fatale Hintergrundfehler werden als kleine Karte
  mit Melden/Ignorieren angezeigt
- Lokale Protokollierung aller Meldungen (Tabelle `support_meldungen`,
  per Selbst-Migration angelegt)
- **SupportHub-Verbindung:** Instanz kann per Support-Schlüssel mit einem
  PraxiOS SupportHub verbunden werden (Übersicht → Support → „Support-Schlüssel
  vorhanden?"); Meldungen landen dann direkt als Ticket beim Dienstleister,
  Paket-Status (Basis/Standard/Premium) wird im Dialog angezeigt; SMTP bleibt
  Fallback bei Hub-Ausfall oder ohne Verbindung

### Technisch

- SMTP-Zugang in gemeinsames Modul `api/lib/smtp.ts` ausgelagert
  (Belegversand + Support nutzen denselben Code)
- Zentrale Versionskonstante `api/lib/version.ts`

## [1.0.0] — 2026-07-24

Erstes öffentliches Release. 🎉

### Enthalten

- Rechnungen (GoBD-Nummernkreise, Teilzahlung, Storno), Gutschriften, Angebote,
  Mahnwesen (PDF + E-Mail), Serien-Rechnungen
- XRechnung 3.0 (KoSIT-validiert), E-Rechnung-Empfang (XML + ZUGFeRD-PDF)
- E-Mail-Versand per SMTP (verschlüsselte Zugangsdaten, Versandprotokoll)
- Kunden/Produkte/Lieferanten, EK/VK + Konditionen, CSV-Importe,
  Altbestand-Import mit Original-Nummern, Nutzungsnachweis-Schnittstelle
- Lager mit Handy-Scan (Code128/PZN/DataMatrix), Etiketten-Druck, Preisvergleich
- Kontoauszug-Import mit Auto-Matching, DATEV-Buchungsstapel (EXTF 700)
- Statistik + UStVA-Hilfsblatt, Benutzerverwaltung (Rollen, scrypt),
  Ersteinrichtungs-Wizard, PWA (mobil), Design-System (Akzentfarben, 3 PDF-Layouts)
- Docker-Betrieb, Selbst-Migration, update.sh, zweisprachige Doku
