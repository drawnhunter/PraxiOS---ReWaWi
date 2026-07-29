# Änderungsprotokoll

Format: [Keep a Changelog](https://keepachangelog.com/de/) · Versionierung: SemVer.

## [1.2.0] — 2026-07-29

### Neu

- **Magic Import:** Neue Seite „Import" — eine Upload-Tür für alles
  (Drag&Drop, bis zu 10 Dateien). Erkennung serverseitig: XRechnung-XML und
  ZUGFeRD-PDF werden direkt als E-Rechnung gebucht, Scans (PDF/JPG/PNG) gehen
  in den Post Manager, SumUp-CSVs (Kunden/Produkte/Bank) werden erkannt und
  zum passenden Bereich gelotst
- **Post Manager:** Eingang für eingescannte Post — Beleg hochladen
  (unveränderbar in der Datenbank, GoBD), per Formular erfassen (Absender,
  Rechnungsnummer, Betrag, Fälligkeit, Wiedervorlage, Konto/Gegenkonto,
  Kategorie), per Klick als Eingangsrechnung buchen (mit Duplikat-Prüfung);
  sonstige Dokumente mit Wiedervorlage-Datum ablegen
- **OCR-Vorschlag:** Belege lokal auf dem Server erkennen lassen (Tesseract
  mit deutschem Sprachpaket im Docker-Image — keine Cloud-KI). Betrag, IBAN,
  Rechnungsnummer, Daten und Fälligkeit werden als Vorschlag mit
  Konfidenz-Farben in die Korrektur-Maske gefüllt; Absender wird gegen
  Lieferanten gematcht
- **Zahlungsziele:** Neue Ansicht mit offenen Eingangsrechnungen,
  Post-Fristen und Wiedervorlagen (überfällig markiert, Bezahlt-Haken) —
  als Liste und als Monatskalender. **ICS-Abo:** geheime Kalender-URL
  (`/ics/zahlungsziele.ics?token=…`) für Google/Outlook/Apple Kalender,
  Token in den Einstellungen neu erzeugbar
- **E-Mail-Eingang (IMAP):** beliebig viele Postfächer in den Einstellungen
  hinterlegen (z. B. rechnung@, post@, befunde@…) — jedes mit eigener Route
  (Rechnung/Sonstiges), Intervall-Abruf im Hintergrund, Verbindungstest,
  verschlüsselte Passwörter; PDF-/Bild-Anhänge landen automatisch im Post
  Manager (Quelle „E-Mail · <Postfach>")
- **Kontierung:** komplette Kontenrahmen SKR03 **und** SKR04 als Basisdaten
  (289/254 Konten, werden beim Start vorbefüllt), dazu pflegbare
  **Kategorien** als Schnellauswahl mit Konto-Mapping; Konto/Gegenkonto am
  Beleg und an der Eingangsrechnung
- **DATEV-Export Eingangsseite:** Eingangsrechnungen wandern jetzt mit in den
  Buchungsstapel (Soll Aufwandskonto an Kreditor, Vorsteuer-BU 9/8; Kreditor
  = Kreditor-Startnummer + Lieferanten-ID, sonst Sammelkonto; neue Felder
  Kreditor-Startnummer und Standard-Aufwandskonto in den Einstellungen)

### Technisch

- Neue Tabellen `post_eingang`, `email_konten`, `kontenrahmen`, `kategorien`
  sowie Spalten `incoming_invoices.konto/gegenkonto` und
  `company_settings.ics_token/kreditor_startnummer/aufwandskonto_default`
  (Selbst-Migration beim Start)
- Dockerfile bringt `tesseract-ocr` (+ deutsches Sprachpaket) und
  `poppler-utils` mit — beim nächsten `docker compose up -d --build` werden
  sie installiert
- Kontenrahmen-Basisdaten: community-kuratiertes Dataset (MIT), in der App
  beliebig erweiterbar

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
