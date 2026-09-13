# Änderungsprotokoll

Format: [Keep a Changelog](https://keepachangelog.com/de/) · Versionierung: SemVer.

## [1.11.3] — 2026-09-13

### Fehlerbehebungen (Agent-API Robustheit)

- **Body-Parsing tolerant:** POST-Endpunkte akzeptieren jetzt JSON
  (`application/json`) UND Formular-Daten (`x-www-form-urlencoded`) —
  Agenten-Clients mit form-encoded Bodies schlagen nicht mehr fehl.
- **Zuordnen per Nummer:** `POST /bankbuchung/:id/zuordnen` akzeptiert
  neben `rechnungId` auch `nummer` (z. B. „2026-017") — Agenten denken in
  Rechnungsnummern, nicht in internen IDs. Klare 404 mit Hinweistext bei
  Nicht-Funden.
- Fehlerantworten traegen jetzt `ok: false` (einheitlich mit Erfolgen).

## [1.11.2] — 2026-09-13

### Neu (Agent-API: Maximum)

- **Zahlungsabgleich schreiben:** `POST /bankbuchung/:id/zuordnen` verknuepft
  eine Buchung mit Ausgangsrechnung (`rechnungId`) oder Eingangsbeleg
  (`eingangsrechnungId`) — inkl. Teilzahlungen, Zahlungsstatus-Update auf
  dem Beleg, Bidirektionalitaet. Nutzt exakt die produktionserprobte Logik
  der UI (`zuordneIntern`), keine Parallel-Implementierung.
- **Aufloesen mit Reversal:** `POST /bankbuchung/:id/loesen` nimmt die
  Zuordnung sauber zurueck (Zahlung auf dem Beleg wird storniert, Buchung
  wieder offen). Der Agent kann eigene Fehler selbst korrigieren.
- Beides auditiert (`agent_log`). Verfuegbar in beiden Autonomie-Stufen:
  interne Buchhaltung mit Umkehrung; der Versand nach aussen bleibt
  weiterhin hinter „vollautomatik" gesperrt.

## [1.11.1] — 2026-09-13

### Neu (Agent-API Erweiterung)

- **Banking fuer den Agenten:** `GET /bankbuchungen?tage=X`,
  `GET /bankbuchung/:id`, `GET /kontostand` (je Konto: saldoNach oder
  Summe), `GET /zahlungsabgleich` (offene Buchungen mit Auto-Match-
  Vorschlag, gleiche Logik wie die UI).
- **Stammdaten fuer den Agenten:** `GET /kunden`, `GET /leistungskatalog`
  (aktive Produkte mit Preisen/USt), `GET /rechnung/:id` (mit Positionen).
- **Schreiben:** `POST /mahnung` (Stufe 1-3 anlegen — Versand bleibt beim
  Menschen) und `DELETE /entwurf/:id` (nur Entwuerfe, GoBD-sicher, mit
  Audit-Eintrag).

## [1.11.0] — 2026-09-12

### Neu

- **Agent-API (Kimi Claw):** REST-Endpunkte unter `/api/agent/*` mit
  Bearer-Token (Klartext nur einmalig bei der Anlage sichtbar, sha256 in
  `agent_tokens`). Lesen: offene/ueberfaellige Rechnungen, Entwuerfe,
  Kunden ohne Rechnung seit X Tagen, Mahnungen, Import-Status. Schreiben:
  Aufgabenliste (anlegen/erledigt, Quelle wird mitprotokolliert),
  Kunden-Quick-Add, Rechnungs-Entwurf (Kunde per ID oder Fuzzy-Name,
  Positionen mit USt-Satz, Summen konsistent).
- **Autonomie-Stufen:** `vorschlag` (Standard: Lesen + Entwuerfe) und
  `vollautomatik` (zusaetzlich Beleg-Versand per E-Mail). Umstellbar in
  Einstellungen → Agent-API — Versand unter „vorschlag" ist serverseitig
  gesperrt (403 mit Hinweis).
- **Agent-Audit:** Jede Schreib-Aktion landet in `agent_log`, sichtbar in
  den Einstellungen inkl. Token-Verwaltung, Stufe, Endpunkt-Doku.
- Settings-Sektion „Agent-API (Kimi Claw)": Token erstellen/deaktivieren,
  Stufe waehlen, curl-Doku fuer die Claw-Konfiguration.

## [1.10.2] — 2026-09-12

### Fehlerbehebungen (Banking)

- **Duplikate beim Mehrformat-Import ausgeschlossen:** Neue Spalte
  `quell_id` speichert die Anbieter-Transaktions-ID; die Dedup prueft sie
  format- UND kontoübergreifend (CSV-Vollexport, schlanker
  Transaktionsbericht und Kontoauszug-PDF tragen dieselbe ID).
- **Neues SumUp-CSV-Format erkannt:** der schlanke Transaktionsbericht
  (5 Spalten, ISO-Datum, vorzeichenbehafteter Betrag) hat jetzt einen
  dedizierten Parser inkl. Transaktions-ID — landet nicht mehr im
  generischen Mapping (das die ID verlor und so Duplikate erzeugte).

### Neu

- **Duplikat-Pruefung (Banking):** Button „Duplikate" gruppiert Buchungen
  mit gleichem Datum+Betrag, empfiehlt Behalten/Löschen und loescht nur
  nicht zugeordnete Eintraege (GoBD-sicher).

## [1.10.1] — 2026-09-11

### Fehlerbehebungen

- **Login über direkte IP/WireGuard funktioniert:** Das Session-Cookie koppelte
  `secure` an localhost statt an TLS. Über `http://192.168.x.x` verwarf der
  Browser das Cookie ohne Fehlermeldung — Login-Loop. Jetzt: `secure` folgt
  `x-forwarded-proto` (Caddy schickt https), direkter Zugriff bekommt
  `secure=false` + SameSite=Lax. Verhalten hinter Caddy unverändert.
  (Fix aus Dr.PaWaWi v1.9.5 portiert, Bus #21 — dynv6-Flaute abgefedert.)

## [1.10.0] — 2026-09-11

### Neu

- **Hub-Fernverwaltung (Pull-Modell, Auftrag Bus #18):** ReWaWi meldet sich
  bei verbundenem Support-Schluessel alle 10 Minuten beim SupportHub
  (Heartbeat: Version, Status, Disk, Uptime, Backup-Frische, Fehler 24 h) und
  holt Befehle ab: `backup` (eigener DB-Dump gzipped ins Backups-Volume
  `/app/backups`, Frische-Stempel wird gesetzt), `diagnose` (Metadaten-Paket),
  `update-hinweis` (wird lokal als Support-Meldung registriert), `ping`→pong.
  Bei Hub-Ausfall laeuft die App still weiter. Ohne Schluessel passiert
  nichts. Grenzen eingehalten: keine Shell, keine Kundendaten — nur Metadaten.
- **Support: manueller Hub-Takt** (Admin) — ein Klick statt 10 Minuten warten
  (Diagnose-Lektion aus dem PaWaWi-Bau).
- Neues Docker-Volume `backups-daten` fuer die Hub-Backups.
- Spec-Faelle aus dem PaWaWi-Bau eingearbeitet: optionale Felder werden
  weggelassen statt null gesendet; Logging pro Takt im Container-Log.

## [1.9.2] — 2026-08-31

### Neu

- **Magic Import erkennt NEM-/Produktlisten (.docx):** Word-Listen werden
  analysiert und als „Produkt-/NEM-Liste → Lieferschein" geroutet. Bei
  erkanntem Kundennamen wird der Lieferschein-Entwurf direkt angelegt
  (inkl. Verlinkung); ohne Kundentreffer verweist der Hinweis auf
  Lieferscheine → NEM-Word-Import (Kunde waehlbar).
- **Rechnung aus Lieferschein:** Am finalisierten Lieferschein erscheint
  „Rechnung erstellen" — Rechnungs-Entwurf mit Positionen, Preisen aus dem
  Produktstamm (Kundenkonditionen zuerst), Fuzzy-Match auf die
  Positionsnamen; der Lieferschein wird mit der Rechnung verknuepft.
  Weg: Lieferung vor Rechnung (GoBD-sauber).

## [1.9.1] — 2026-08-31

### Fehlerbehebungen

- **Produktiv-Start repariert:** Dynamische Builtin-Imports im
  SumUp-PDF-Parser erzeugten im gebuendelten `dist/boot.js` einen doppelten
  `createRequire`-Import (SyntaxError beim Start, Crash-Loop, 502). Jetzt
  statische Imports. Neue SOP-Stufe: nach dem Build wird `node dist/boot.js`
  mindestens bis zur Laufzeit-Umgebung gestartet (Parse-Check).

## [1.9.0] — 2026-08-28

### Neu

- **Statistik verstaendlicher:** Erklaer-Bubbles (?) an allen Kennzahlen —
  netto vs. brutto und Umsatz vs. Zahlungseingang werden jetzt erklaert
  (loest die „Juli-Verwirrung": Eingaenge brutto nach Zahlungsdatum koennen
  ueber dem Netto-Umsatz liegen). Umsatz-Karten zeigen netto gross + brutto
  klein. Verlaufs-Balken sind anklickbar und zeigen die Monats-Zusammensetzung.
- **Liquiditaetsplanung (Statistik):** Jahresmatrix mit Umsatz netto/brutto,
  Einnahmen (Zahlungsdatum) und Ausgaben (Eingangsrechnungen) je Monat —
  Balken anklickbar (Zusammensetzung, offene Belege). Monatsbudget
  einstellbar (PiggyBank), Erreichung absolut + prozentual, Ampel
  gut/mittel/schlecht mit Klartext-Satz. Export als CSV und als SVG-Grafik.
  Fusszeile: „Kunden schulden dir X / du musst noch Y zahlen".
- **Mahn-Automatik in der Uebersicht:** Karte „Mahnwesen — Handlungsbedarf"
  listet ueberfaellige Rechnungen mit Kunde, Nummer, Fälligkeit, offenem
  Betrag, bisheriger Stufen-Anzahl und direktem Button „Erinnern" /
  „Anmahnen (Stufe n)" zur Rechnung. Faellig, wenn noch keine Stufe rausging
  oder die Frist der letzten Stufe abgelaufen ist.

## [1.8.0] — 2026-08-28

### Neu

- **Produkt-Suche ueberall:** Produktstamm-Auswahl in Rechnung, Angebot,
  Bestellung und Lieferschein jetzt mit Suchfeld und tippfehlertoleranter
  Fuzzy-Suche (findet auch naheliegende Begriffe). Dieselbe Suche steckt in
  der Bezeichnungs-Zeile jeder freien Position — Tippen zeigt Vorschlaege,
  Klick uebernimmt Name, Beschreibung, Einheit, Preis (inkl. Kundenkondition)
  und USt-Satz.
- **NEM-/Word-Import:** Lieferscheine koennen aus Word-Dateien (.docx)
  erzeugt werden — einheitliche Tabellen-Vorlage und alte Freitext-Listen
  werden erkannt. Artikel werden automatisch dem Produktstamm zugeordnet
  (Fuzzy-Match, Vorschau mit Ampel), der Kunde wird aus dem Dokumentnamen
  vorgeschlagen. Ergebnis: Lieferschein-Entwurf.
- **Rabatte in Rechnungen:** neue Spalte „Rabatt" je Position (% oder
  Festwert in der konfigurierbaren Waehrung) plus Hauptrabatt auf Belegebene
  mit optionalem Addier-Modus. PDF, XRechnung (EN16931 AllowanceCharges) und
  Summen rechnen konsistent; Duplizieren uebernimmt Rabatte.
- **Angebote: neue Statuslogik** — offen (= versendet), bestaetigt (gruen),
  abgelehnt, verstrichen (automatisch bei ueberschrittenem Gueltigkeitsdatum).
  Finalisieren fragt jetzt das Angebotszeitfenster: 7 / 14 / 30 Tage oder
  freie Tageszahl. Umwandeln in Rechnung aus offen/bestaetigt.
- **Einstellungen: Waehrung waehlbar** (Symbol/Code, z. B. €, $, CHF) —
  Grundlage fuer Auslandslieferungen.

### Fehlerbehebungen

- Angebots-PDF trug im Metadaten-Titel faelschlich „Gutschrift" (jetzt
  „Angebot").
- Rechnungsliste: ueberfaellige Rechnungen zeigen nur noch das
  Ueberfaellig-Label, nicht mehr mehrere Badges gleichzeitig.
- XRechnung-Versand: die im Versand-Dialog eingetragene Empfaenger-Adresse
  wird jetzt auch als Kaeufer-Adresse (BT-49) verwendet — kein Zwang mehr,
  sie vorher beim Kunden zu hinterlegen. Optional nach dem Versand als
  Standard-E-Mail des Kunden speichern (Checkbox).

## [1.7.2] — 2026-08-23

### Neu

- **Banking: SumUp-Kontoauszug als PDF importieren.** Der Auszug aus dem
  SumUp-Geschaeftskonto („Geschaeftskonto → Kontoauszug", PDF mit Textebene)
  wird jetzt direkt gelesen — ohne OCR. Inklusive stabiler Transaktions-IDs
  (formatuebergreifender Duplikat-Schutz mit dem CSV-Vollexport), Saldo nach
  jeder Buchung und **Pruefsummen-Abgleich** (Anfangsguthaben + Buchungen =
  Endguthaben) mit Anzeige im Importergebnis. Nicht genehmigte Buchungen
  werden uebersprungen und beim naechsten Auszug automatisch nachgeholt.

## [1.7.1] — 2026-08-23

### Sicherheit

- **DB-Fehler werden maskiert:** Rohe Treiberfehler (Query-Text, Parameter,
  Schema-Details) gehen bei Datenbank-Ausfaellen nicht mehr an den Client.
  Der tRPC-errorFormatter zeigt eine generische Meldung; volle Details stehen
  ausschliesslich im Server-Log. Fachliche Fehlermeldungen bleiben unberuehrt.
  (Muster uebernommen aus Dr.PaWaWi v1.7.3)

### Robustheit

- **Nummernkreis-Selbstheilung beim Boot:** Zaehler (Rechnung, Angebot,
  Lieferschein, Bestellung, Gutschrift) werden beim Start automatisch auf die
  hoechste real vergebene Nummer angehoben, falls sie zurueckliegen — schuetzt
  vor ER_DUP_ENTRY nach Altbestand-Importen oder Reparatur-Eingriffen.
  Es wird niemals abgesenkt. (Muster aus Dr.PaWaWi v1.7.2)
- **Migrations-Wachtest:** Neuer statischer Test (`api/migrate.test.ts`)
  verhindert AFTER-Verweise auf spaeter angelegte Spalten, Doppel-Anlagen und
  Selbstreferenzen bereits zur Build-Zeit.

## [1.7.0] — 2026-08-10

### Neu

- **Zeiterfassung:** Neuer Menuepunkt mit vier Bereichen
  - **Stempeln:** Start/Stop pro Mitarbeiter (inkl. optionalem Kunden und
    Taetigkeits-Notiz), laufende Stempel mit Sekunden-Timer; nur ein
    laufender Stempel pro Mitarbeiter
  - **Eintraege:** Filter (Mitarbeiter, Kunde, Zeitraum, nur offene,
    Suche), sortierbare Tabelle mit H:mm-Anzeige, manuelles Anlegen,
    **GoBD-Freigabe** (gesperrte/abgerechnete Eintraege unveraenderbar),
    Löschen nur solange offen
  - **Auswertung:** Stunden-Matrix pro Mitarbeiter x Kunde je Monat
  - **Mitarbeiter:** Stamm mit Farbe und Stundensatz
- **Stunden → Rechnungsentwurf:** Offene Eintraege eines Kunden
  auswaehlen und per Klick als Rechnungspositionen abrechnen (Menge in
  Stunden, Preis aus Stundensatz-Produkt oder Mitarbeiter-Satz);
  Eintraege werden mit der Rechnung verknuepft und sind damit
  abgerechnet

### Technisch

- Neue Tabellen `mitarbeiter` und `zeiteintraege` (Selbst-Migration beim
  Start; FKs auf customers und invoices)

## [1.6.4] — 2026-08-10

### Neu

- **Demo-PC:** **Scene-2005-Theme** (Emo/MySpace-Look als umschaltbares
  Layout im Startmenue, mit eigenem Pop-Punk-Loop), **h4x0r t3rm1n4l**
  liegt jetzt versteckt im Startmenue statt als Desktop-Icon, und die
  Demo-Dateien loesen per Klick einen gefuehrten Flow aus (Download +
  ReWaWi-Fenster springt auf den passenden Import + Hinweis-Bubble) —
  ersetzt das im Browser technisch nicht machbare Drag&Drop zwischen
  Desktop und iframe; Desktop-Icons liegen nicht mehr ueber den Fenstern

## [1.6.3] — 2026-08-10

### Neu

- **Demo-PC:** Fenster jetzt **skalierbar** (rechte Kante, untere Kante,
  Ecke unten rechts); Versionsanzeige im Boot und Startmenue wird
  **dynamisch** aus der laufenden App gelesen (kein hardcodierter Stand
  mehr); beim Maximieren bleibt die Desktop-Icon-Spalte sichtbar

## [1.6.2] — 2026-08-10

### Neu

- **Demo-PC: Party-Pack** (`/xp-desktop/`): **Minesweeper** als spielbares
  Fenster-Game (9x9, Flaggen, Smiley-Reset), **h4x0r t3rm1n4l** als
  Fake-Hacker-Konsole mit Tipp-Animation und Fortschrittsbalken, und ein
  **Musik-Toggle** im Startmenue mit Eurodance-Loop (lizenzfrei generiert)

### Behoben

- **Magic Import reagierte nicht mehr auf Drag&Drop:** Ein Fehler beim
  Lesen oder Analysieren einer Datei (z. B. ungueltiges XML) brach den
  gesamten Vorgang still ab — jetzt Fehler-Banner in der UI, und die
  serverseitige Analyse faengt Fehler pro Datei ab (eine kaputte Datei
  blockiert den Rest nicht mehr)

## [1.6.1] — 2026-08-09

### Neu

- **PraxiOS Demo-PC (XP-Desktop):** Simulierter Frueh-2000er-Desktop als
  spielerischer Einstieg in die Live-Demo (`/xp-desktop/` in der App):
  Boot-Sequenz, verschiebbare Fenster mit ReWaWi-Iframe (gleiche Origin),
  Demo-Dateien-Ordner (Test-XRechnung, SumUp-Vollexport, Scan-PDF,
  Kunden-CSV), Startmenue mit Hintergrund-Wahl (Wiese/Herbst/Abend) und
  Sound-Chimes — alle Assets lizenzfrei generiert

### Behoben

- **Unternehmen/Einstellungen:** Bei fehlenden Firmendaten (z. B. nach
  uebersprungener Ersteinrichtung) erscheint jetzt ein klarer Hinweis
  statt endlosem „Lade …"
- **Eingangsbelege:** Query-Fehler werden als Fehlermeldung angezeigt
  statt irrtuemlich leerer Liste

## [1.6.0] — 2026-08-09

### Neu

- **Unternehmen (Company Control):** Neuer Menuepunkt — alle registrierten
  Kennnummern an einem Ort: Handelsregister, Steuernummer, USt-IdNr.,
  EORI, Betriebsnummer (Agentur fuer Arbeit), BG-Mitgliedsnummer, IHK/HWK
  und SEPA-Glaeubiger-ID; fehlende Nummern werden oben angemahnt.
  Dazu **freie Kennwerte** (beliebige weitere Nummern) mit
  **Beleg-Verknuepfung** zum Post Manager (Bescheid direkt erreichbar)
- **Rechnungen-Seitenpanel:** Klick auf eine Rechnung oeffnet rechts ein
  Panel statt direkt die Detailseite — Schnellblick (Kunde, Brutto/Offen,
  Fälligkeit), **Verlauf/Timeline** (Entwurf → Finalisierung →
  E-Mail-Versand → Zahlung/Bank-Zuordnung → Gutschriften) und Aktionen:
  Öffnen, PDF, Vorschau, **Duplizieren** (Kopf + Positionen in neuen
  Entwurf), Gutschrift, **Archivieren/Entarchivieren**, Löschen
  (Entwurf)
- **Archiv-Filter:** Die Rechnungen-Liste filtert standardmaessig auf
  nicht-archivierte Belege; Archivierte sind ueber den Filter
  „Archiviert" erreichbar (GoBD: nichts wird geloescht)
- **Regelwerk Post Manager:** Lieferanten bekommen eine
  **Standard-Kategorie** (Stammdaten); eingescannte Belege dieses
  Lieferanten schlagen Kategorie, Konto und USt-Satz automatisch vor —
  bei OCR-Erkennung und bei manueller Absenderwahl (überschreibbar)
- **Banking:** Verwendungszweck per Klick auf die Zeile als Volltext
  aufklappbar (inkl. Gebühr und Import-Referenz)

### Technisch

- Neue Tabelle `company_kennwerte`; neue Spalten `invoices.archiviert`,
  `suppliers.kategorie_id` und fuenf Kennnummern in `company_settings`
  (Selbst-Migration beim Start)

## [1.5.0] — 2026-08-04

### Neu

- **Eingangsbelege — die zentrale Eingangsseite:** Die bisherige
  „E-Rechnungen"-Seite wird zur kompletten Eingangs-Uebersicht mit Tabs
  (Deeplinks via `?tab=`):
  - **Rechnungen:** gebuchte Eingangsrechnungen wie bisher — plus
    **Summen-Chips** (Offen/Ueberfaellig/Bezahlt) und **CSV-Export**
    (inkl. Konto/Gegenkonto) fuer die buchhalterische Auswertung
  - **Lieferscheine / Gutschriften / Archiv:** die GoBD-Ablage aus dem
    Post Manager — sortierbare, durchsuchbare Liste mit PDF-/Bild-Viewer
    (nur ansehen; Bearbeiten per Klick im Post Manager)
- **Schnellwechsel-Links:** Auf den Seiten Rechnungen, Lieferscheine,
  Gutschriften und Bestellungen oben rechts direkt zur passenden
  Eingangs-Ansicht springen (z. B. Lieferscheine → Eingangslieferscheine)
- **Post-Manager-Deeplink:** `/posteingang?beleg=ID` oeffnet ein Dokument
  direkt (z. B. aus dem Eingangsbelege-Viewer)

### Behoben

- Post Manager: Spalte „Eingang" zeigte Datum falsch formatiert an
  (Timestamp wurde als Text statt ISO gelesen)

## [1.4.0] — 2026-08-04

### Neu

- **Massen-Upload im Post Manager:** Ganze Scan-Stapel auf einmal hochladen
  (Mehrfachauswahl, 10er-Pakete mit Fortschrittsanzeige, bis 30 Dateien je
  Paket, 12 MB pro Datei) — mit Typ-Vorwahl; nach dem Upload oeffnet sich
  direkt der erste Beleg zur Erfassung
- **Neue Dokumenttypen:** Neben Rechnung und Sonstiges jetzt auch
  **Lieferschein** und **Gutschrift** (Eingang) — mit Filter, Badge in der
  Liste und Auswahl im Erfassungsformular; buchbar bleiben nur Rechnungen
  (Schutz besteht), Lieferscheine/Gutschriften werden GoBD-sicher abgelegt
  und erfasst
- **Durchraster-Workflow:** Pfeil-Navigation im Beleg-Dialog (Position
  x/y der gefilterten Liste) und **„Buchen & naechster"** — speichert,
  bucht und springt direkt zum naechsten offenen Beleg (ideal fuer den
  Digitalisierungs-Marathon)
- **Rechnungen-Tabelle:** Alle sieben Spalten jetzt per Klick sortierbar
  (Nummer, Kunde, Datum, Fällig, Status, Brutto, Offen) — die Sortierung
  war vorbereitet, aber nie an die Koepfe angeschlossen

### Technisch

- Selbst-Migration kann jetzt auch Struktur-Updates an bestehenden Tabellen
  (hier: `post_eingang.typ`-Enum um `lieferschein`/`gutschrift`) —
  idempotent per information_schema-Check, wie gehabt beim Start

## [1.3.1] — 2026-08-04

### Neu

- **SumUp-Konto Vollexport:** Der 15-spaltige SumUp-Transaktionsbericht
  wird jetzt nativ erkannt und importiert — deutsches Datumsformat
  („03.08.26, 17:54"), Betrag aus Rechnungsbetrag eingehend/ausgehend,
  Zahlungsreferenz (z. B. „Rechnung Nr.431260") landet im Zweck und
  ermoeglicht Auto-Matching auf Eingangsrechnungen, Gebuehren und Saldo
  werden uebernommen, Fremdwaehrungs-Abrechnungen (z. B. USD) erscheinen
  als Hinweis im Zweck (gebucht wird der EUR-Rechnungsbetrag)
- **Duplikat-Schutz per Transaktions-ID:** SumUp-Buchungen werden an ihrer
  stabilen ID erkannt — identische Betraege (z. B. zwei gleiche
  Rueckerstattungen) bleiben korrekt unterscheidbar, erneute Importe
  ueberspringen sicher
- **Vorgemerkte Buchungen** („In Bearbeitung", abgelehnt, fehlgeschlagen)
  werden mit Zaehler-Hinweis uebersprungen und nach Statuswechsel beim
  naechsten Import automatisch nachgeholt

## [1.3.0] — 2026-08-03

### Neu

- **Banking — das große Bank-Update:** Kontoauszuege werden jetzt dauerhaft
  je Bankkonto gespeichert (Duplikat-Erkennung per Hash), nicht mehr nur
  fluechtig durchgematcht
  - **Konto-Karten:** Saldo je Konto (aus Saldo-Spalte oder berechnet),
    offene Posten, letzte Buchung, letzter Import — beliebig viele Konten
  - **Ein- UND Ausgaenge:** Import verarbeitet jetzt auch Ausgaben;
    Auto-Matching ordnet Ausgaenge offenen Eingangsrechnungen zu
    (Betrag/Lieferant/Nummer im Zweck)
  - **Transaktionsliste:** Suche, Status-/Richtungs-/Zeitraum-Filter,
    sortierbare Spalten; Saldo-Spalte im Mapping (neu)
  - **Zuordnung in beide Richtungen:** von der Transaktion zur Rechnung
    UND von der Rechnung zur Transaktion (neue Sektion „Bank-Zuordnung"
    im Rechnungsdetail, mit passenden Vorschlaegen); Loesen bucht die
    Zahlung sauber zurueck
  - **Kontoauszug als PDF:** aktuelle Ansicht (Zeitraum waehlbar) als
    sauberer Auszug mit Summen und Salden
  - **Import-Historie:** Chargen je Konto mit Summen, Duplikaten,
    Loeschfunktion (solange nichts davon verbucht ist); ignorieren/
    reaktivieren fuer private oder interne Buchungen
- **Alle Tabellen sortierbar:** Klick auf jede Spaltenueberschrift schaltet
  auf-/absteigend um (Angebote, Gutschriften, Lieferscheine, Bestellungen,
  Post Manager, Zahlungsziele neu; Rechnungen/Kunden/Produkte/Lieferanten/
  E-Rechnungen/Lager hatten es bereits)
- **Suche in allen Listen:** Rechnungen, Angebote, Gutschriften,
  Lieferscheine, Bestellungen, E-Rechnungen, Post Manager, Zahlungsziele,
  Banking

### Technisch

- Neue Tabellen `bank_importe` und `bank_transaktionen` (Selbst-Migration
  beim Start; GoBD: zugeordnete Transaktionen sind loeschgeschuetzt)

## [1.2.2] — 2026-08-03

### Behoben

- **Rechnungserstellung nach Altbestand-Import blockiert:** Der Import
  (SumUp-PDF/XRechnung/CSV) hebt den eigenen Nummernkreis jetzt an, wenn
  eine importierte Original-Nummer dem eigenen Format (JJJJ-NNN) entspricht;
  die Finalisierung ueberspringt belegte Nummern zusaetzlich automatisch,
  statt mit ER_DUP_ENTRY zu scheitern
- **Selbst-Migration brach auf Bestandsdatenbanken ab:** `post_eingang`
  wurde vor `kategorien` angelegt (FK-Reihenfolge) und ein Fehler stoppte
  alle Folgeschritte — dadurch fehlten `email_konten`, `kontenrahmen` und
  `kategorien` komplett (IMAP-Fehler im Log). Reihenfolge korrigiert, jeder
  Migrationsschritt laeuft jetzt isoliert mit eigenem Fehler-Log

### Technisch

- `docker-compose.yml`: Secrets nur noch per Umgebungsvariable
  (`.env`/`docker-compose.override.yml`), kein Klartext-Default mehr;
  DB-Healthcheck liest das Passwort selbst aus der Container-Umgebung
  (funktioniert mit jedem Passwort, keine Handanpassung mehr noetig)

## [1.2.1] — 2026-08-01

### Neu

- **SumUp-Rechnungs-PDF-Import:** Beim Rechnungen-Import werden jetzt auch
  die von SumUp erzeugten Rechnungs-PDFs erkannt (Text-PDF, lokal per
  pdftotext — keine Cloud), inkl. Positionen, Summen, Zahlungsstatus und
  Plausibilitaets-Warnungen; stornierte Belege werden abgewiesen
  (Storno bitte manuell als Gutschrift erfassen). Hintergrund: Die
  SumUp-Exportdateien waren fuer eine GoBD-konforme Uebernahme zu
  unvollstaendig.
- **Magic Import:** SumUp-PDFs werden erkannt und zum Altbestand-Import
  geroutet (neue Route „altbestand").
- **XRechnung im Altbestand-Import:** Ausgehende XRechnung-XMLs koennen
  ebenfalls dateibasiert als Altbestand eingebucht werden.

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
