# ReWaWi Agent-API — Leitfaden (Stand v1.21.5)

Vollständige Endpunkt-Referenz der REST-API für externe Agenten (Kimi Claw).

- **Basis:** `https://<host>/api/agent`
- **Auth:** `Authorization: Bearer ax_…` (Token aus Einstellungen → Agent-API; Klartext nur einmalig bei der Anlage sichtbar)
- **Fehler:** `{"ok": false, "fehler": "Klartext"}` mit HTTP-Status 400/401/403/404/409/422/502
- **DSGVO:** Namen erscheinen pseudonymisiert (K-/L-Nummern), Bank-Gegenstellen maskiert; im Pseudonym-Modus nur Ort auf Stadtebene, keine Straße/E-Mail.
- **Konventionen:** `*` = Pflichtfeld · Datumsformat `JJJJ-MM-TT` · Beträge in EUR als Zahl (`1234.56`) · `:id` = numerische ID (nicht Nummer, Ausnahmen stehen dabei).
- **Audit:** Jede Schreib-Aktion wird in `agent_log` protokolliert (Einstellungen → Agent-API, oder `GET /audit-log`).
- **Alias-Regel:** Wo Aliase existieren (`/bankbuchungen/import`, `/eingangsrechnung(en)`, `/export/datev`), liefern beide Pfade dasselbe — 404 heißt: Instanz läuft noch auf altem Stand.
- **Vollständigkeit:** Diese Referenz deckt alle Routen aus `api/agentRouter.ts` ab; maschinell geprüft per `node scripts/pruefeDoku.mjs`.

## Inhalt
1. [Status & Unternehmen](#status--unternehmen)
2. [Rechnungen & Kunden](#rechnungen--kunden)
3. [Mahnungen & Gutschriften](#mahnungen--gutschriften)
4. [Banking](#banking)
5. [Kontierung & DATEV](#kontierung--datev)
6. [Belege (Eingangsrechnungen)](#belege-eingangsrechnungen)
7. [Import & Historie](#import--historie)
8. [Mail](#mail)
9. [Mail-Konten](#mail-konten)
10. [Kontakte](#kontakte)
11. [Kalender, Fristen & Posteingang](#kalender-fristen--posteingang)
12. [Aufgabenliste](#aufgabenliste)
13. [Statistik, UStVA & Berichte](#statistik-ustva--berichte)
14. [Steuerberater-Paket](#steuerberater-paket)
15. [Transparenz & Vertrauen](#transparenz--vertrauen)
16. [Autonomie-Stufen](#autonomie-stufen-einstellungen--agent-api)
17. [Optimale Nutzungs-Wege für Agenten](#optimale-nutzungs-wege-für-agenten)
18. [Token-Sparsamkeit](#token-sparsamkeit-harness-disziplin--nvidia-sol-pi-konsens)
19. [Stolpersteine (FAQ)](#stolpersteine-faq)

---

## Status & Unternehmen

### GET /status
Heartbeat; zeigt auch die laufende Version (prüfen, ob ein Feature schon live ist).
**Antwort:** `{produkt, version, zeit}`
```json
{"produkt": "ReWaWi", "version": "1.21.5", "zeit": "2026-10-21T08:00:00.000Z"}
```

### GET /uebersicht/heute
Morgen-Briefing in einem Call: überfällige Zahlungsziele, heutige Termine, Mail-Zähler, offene Bankbuchungen ohne Zuordnung, offene Aufgaben.
**Antwort:** `{datum, ueberfaelligeZiele: [...], termineHeute: [{id, titel, startZeit}], mailsNeu24h, mailsUngelesen, bankOffenOhneZuordnung, aufgabenOffen: [{id, text, prioritaet, faelligAm}]}`

### GET /unternehmen
Firmen-Stammdaten lesen (für Rechnungstexte, Briefpapier-Angaben, USt-Prüfung).
**Antwort:** `{name, strasse, plz, ort, land, email, telefon, webseite, ustIdNr, steuernummer, handelsregister, eori, betriebsnummer, bgMitgliedsnummer, ihk, glaeubigerId}` (je Feld `null`, wenn leer)

### POST /unternehmen
Stammdaten mergen (Whitelist, leere Strings löschen das Feld). Schreibt ins Audit-Log.
**Body:** beliebige Teilmenge der Felder aus `GET /unternehmen` — mindestens eines.
**Antwort:** `{ok: true, aktualisiert: ["telefon"]}`
```json
{"telefon": "+49 30 123456", "webseite": "https://www.muster-gmbh.example"}
```

---

## Rechnungen & Kunden

### GET /offene-rechnungen
Offene + überfällige finalisierte Rechnungen, nach Fälligkeit sortiert.
**Antwort:** `{anzahl, ueberfaellig, rechnungen: [{id, nummer, kunde, kundenId, brutto, offen, rechnungsdatum, faelligkeitsdatum, ueberfaellig}]}`

### GET /entwuerfe
Rechnungs-Entwürfe (warten auf Freigabe/Finalisierung).
**Antwort:** `{anzahl, entwuerfe: [{id, kunde, kundenId, netto, brutto, datum}]}`

### GET /rechnungen?q=&von=&bis=&status=
Rechnungs-Suche: `q` = Nummern-Teilstring, `von`/`bis` = Rechnungsdatum, `status` = `entwurf|finalisiert|storniert`. Max. 100 Treffer.
**Antwort:** `{anzahl, rechnungen: [{id, nummer, status, datum, kunde, brutto, bezahlt}]}`

### GET /rechnung/:id
Einzelrechnung inkl. Positionen.
**Antwort:** `{id, nummer, status, kunde, kundenId, rechnungsdatum, faelligkeitsdatum, netto, ust, brutto, bezahltBetrag, positionen: [{position, bezeichnung, beschreibung, menge, einheit, einzelpreis, ustSatz}]}`

### GET /rechnung/:id/pdf
Rechnungs-PDF als base64 — dasselbe GoBD-PDF wie der UI-Download. Entwürfe → 409 (erst finalisieren oder Proforma setzen).
**Antwort:** `{ok: true, dateiname: "Rechnung-2026-0042.pdf", base64: "…", mime: "application/pdf"}`

### GET /rechnung/:id/zahlungen
Zugeordnete Bankbuchungen einer Rechnung + `differenzManuell` (≠ 0 heißt: Betrag wurde manuell ohne Bankzuordnung gebucht).
**Antwort:** `{rechnungId, nummer, brutto, bezahltBetrag, bezahltAm, summeZuordnungen, differenzManuell, hinweis, zahlungen: [{transaktionId, datum, betrag, zugeordneterBetrag, zugeordnetAm, name, konto, status}]}`

### GET /kunde/:id/rechnungen
ALLE Rechnungen eines Kunden (max. 200, neueste zuerst).
**Antwort:** `{anzahl, rechnungen: [{id, nummer, status, datum, faellig, brutto, bezahlt, offen}]}`

### GET /kunden-ohne-rechnung?tage=30
Kunden ohne finalisierte Rechnung seit `tage` Tagen (7–365) — Vertriebs-/Wiedervorlage-Liste.
**Antwort:** `{tage, anzahl, kunden: [{id, name, email, letzteRechnung}]}` (E-Mail im Pseudonym-Modus maskiert als `…@domain`)

### GET /kunden
Alle Kunden. Im Pseudonym-Modus nur `{id, name, ort, land, zahlungszielTage}`, sonst zusätzlich `{zusatz, strasse, plz, email}`.
**Antwort:** `{anzahl, kunden: [...]}`

### GET /kunde/:id
Einzelner Kunde (gleiche Pseudonym-Regeln wie `/kunden`).
**Antwort:** `{id, name, ort, land, zahlungszielTage, …}`

### GET /kunde/nach-email/:email
E-Mail → Kunde. Zuordnung Mail↔Kunde, ohne Klartext-Kundendaten rauszugeben. URL-encoded Adresse übergeben.
**Antwort:** `{ok: true, kundenId, pseudonym, ort}` — 404, wenn kein Treffer.

### GET /kunde/nach-name/:name
Fuzzy-Namenssuche → bis zu 5 Kandidaten (Score ≥ 55). Für „Finde die kundenId zu diesem Namen".
**Antwort:** `{ok: true, anzahl, kandidaten: [{kundenId, pseudonym, ort, score}]}`

### POST /kunde
Quick-Add Kunde; vergibt sofort ein Pseudonym.
**Body:** `{name*: string, zusatz?, strasse?, plz?, ort?, land?, email?}` (Default `land: "Deutschland"`)
**Antwort:** `{ok: true, id, name, synonym}`
```json
{"name": "Muster GmbH", "ort": "Berlin", "email": "buchhaltung@muster-gmbh.example"}
```

### PUT /kunde/:id
Kunde aktualisieren (Merge — nur übergebene Felder werden geändert).
**Body:** `{name?, zusatz?, strasse?, plz?, ort?, land?, email?, kundennummer?, zahlungszielTage?, notizen?}`
**Antwort:** `{ok: true, id}`

### POST /rechnung-entwurf
Rechnungs-Entwurf anlegen — **der Mensch gibt frei** (oder Vollautomatik). Zahlungsziel aus Kunde/Einstellungen (Default 14 Tage). Mit `typ: "proforma"` wird ein Proforma-Entwurf angelegt (Vorschuss-Anforderung).
**Body:** `{"kundenId": N | "kunde": "Name" (Fuzzy), items*: [{bezeichnung*: string, beschreibung?, menge? (Default 1), einheit? (Default "Stück"), einzelpreis*: number, ustSatz?: 19|7|0 (Default 19)}], typ?: "proforma", pdfNotiz?: string}` — `items` auch als JSON-String möglich (Form-Data).
**Antwort:** `{ok: true, id, kunde, kundenId, brutto, hinweis}`
```json
{"kunde": "Muster GmbH", "items": [{"bezeichnung": "Beratung Oktober", "menge": 4, "einheit": "Std.", "einzelpreis": 120}], "pdfNotiz": "Zahlbar innerhalb von 14 Tagen."}
```

### PATCH /rechnung-entwurf/:id
Entwurfs-Daten korrigieren (Bus #191) — **nur im Status `entwurf`** (finalisierte Rechnungen sind GoBD-unveränderbar → 409). Mindestens ein Feld angeben.
**Body:** `{rechnungsdatum?: "JJJJ-MM-TT", faelligkeitsdatum?: "JJJJ-MM-TT"}` — Validierung: `faelligkeitsdatum` darf **nicht vor** `rechnungsdatum` liegen (sonst 400).
**Antwort:** `{ok: true, id, rechnungsdatum?, faelligkeitsdatum?}`
```json
{"rechnungsdatum": "2026-10-01", "faelligkeitsdatum": "2026-10-31"}
```

### DELETE /entwurf/:id
Entwurf löschen (inkl. Positionen). **Nur Entwürfe** (GoBD) — finalisierte Rechnungen → 409.
**Antwort:** `{ok: true, geloescht: id, kunde}`

### POST /rechnung/:id/finalisieren
Entwurf finalisieren (Nummernkreis + GoBD-Snapshot) — oder mit Body `{"typ": "proforma"}` als Proforma setzen (ohne Nummer, für Vorschuss).
**Body:** optional `{typ?: "proforma"}`
**Antwort:** `{ok: true, id, nummer, status: "finalisiert"}` bzw. `{ok: true, id, status: "proforma"}`

### POST /rechnung/:id/vorkasse-setzen
Proforma → Vorkasse (`abschlagBetrag` = bereits bezahlter Betrag; vorher `POST /rechnung/:id/zahlung` buchen).
**Antwort:** `{ok: true, id, status, abschlagBetrag, …}`

### POST /rechnung/:id/in-rechnung-umwandeln
Proforma/Vorkasse → echte Rechnung (Nummernkreis + Snapshots).
**Antwort:** `{ok: true, id, nummer, status: "finalisiert", …}`

### POST /rechnung/:id/zahlung
Zahlung registrieren (Default: voller Restbetrag, heute). Nicht bei Entwürfen (409).
**Body:** `{betrag?: number, datum?: "JJJJ-MM-TT"}`
**Antwort:** `{ok: true, id, zugebucht, datum}`

### POST /rechnung/:id/versenden
Rechnungs-PDF per Mail an den Kunden. **Autonomie-Gate:** vollautomatik ODER Token-Freigabeliste deckt den Empfänger (sonst 403 → Alternative: `GET /rechnung/:id/pdf` + `POST /mail/entwurf`). Nicht bei Entwürfen (409).
**Body:** `{empfaenger?: string (Default: Kunden-E-Mail), betreff?, text?}`
**Antwort:** `{ok: true, empfaenger}`
```json
{"betreff": "Ihre Rechnung 2026-0042", "text": "Anbei Ihre Rechnung als PDF."}
```

### GET /leistungskatalog
Aktive Produkte/Leistungen (Preise + USt-Sätze) — Grundlage für `items` in `/rechnung-entwurf`.
**Antwort:** `{anzahl, produkte: [{id, name, artikelnummer, beschreibung, einheit, preisNetto, ustSatz, kategorie}]}`

---

## Mahnungen & Gutschriften

### GET /mahnungen
Überfällige Rechnungen mit Mahnstufen-Stand.
**Antwort:** `{anzahl, faellig: [{rechnungId, nummer, kunde, faelligkeitsdatum, offen, stufenBisher, naechsteStufe}]}`

### POST /mahnung
Nächste Mahnstufe anlegen (Vorschlag — **PDF/Versand bleibt beim Menschen**). Nur finalisierte, unbezahlte Rechnungen.
**Body:** `{rechnungId*: number, stufe?: 1|2|3 (Default 1), zahlungsfrist?: "JJJJ-MM-TT" (Default heute + 10 Tage)}`
**Antwort:** `{ok: true, id, stufe, nummer, hinweis}`

### DELETE /mahnung/:id
Irrtümlich angelegte Mahnung löschen.
**Antwort:** `{ok: true, geloescht: id}`

### POST /rechnung/:id/gutschrift
Gutschrift als **Entwurf** aus einer finalisierten Rechnung (Teil oder komplett, freie Positionen). Der Mensch finalisiert in der UI (Nummernkreis + PDF automatisch) — GoBD-sicher, kein Auto-Finalisieren durch den Agenten.
**Body:** `{positionen*: [{bezeichnung*: string, menge?: number, einzelpreis*: number, ustSatz?: 0|7|19}], grund?: string, pdfNotiz?: string}`
**Antwort:** `{ok: true, id, status: "entwurf", netto, ust, brutto, hinweis}`
```json
{"positionen": [{"bezeichnung": "Kulanzgutschrift Beratung", "einzelpreis": 240}], "grund": "Reklamation vom 15.10."}
```

### POST /rechnung/:id/stornieren
GoBD-Vollstorno: legt finalisierte Gutschrift über den vollen Betrag an (Nummernkreis automatisch) und setzt die Rechnung auf `storniert`. Nur finalisierte Rechnungen (409 sonst).
**Body:** optional `{grund?: string}`
**Antwort:** `{ok: true, storniert: id, gutschrift: "GS-2026-0007"}`

### GET /gutschriften
Alle Gutschriften mit Rechnungsbezug (Kundennamen pseudonymisiert).
**Antwort:** `{anzahl, gutschriften: [{id, nummer, status, datum, rechnung, rechnungId, kunde, netto, ust, brutto, grund}]}`

---

## Banking

### GET /kontostand
Je Konto Saldo + **hier findest du die `bankAccountId`** für Import-Calls (SumUp: IBAN beginnt mit `IE10SUMU…`). Saldo-Auswahl seit v1.21.4: neuestes Datum → neuester Import → niedrigste ID (Importe werden „neueste zuerst" eingespielt — Bus #176/#177).
**Antwort:** `{konten: [{kontoId, bankAccountId (Alias), bezeichnung, iban, saldo, quelle: "saldoNach"|"summe"}]}`

### GET /bankbuchungen?tage=30&q=&von=&bis=&betragMin=&betragMax=&kontoId=
Buchungen-Liste (max. 1000). `q` durchsucht Name+Zweck; `von`/`bis` (JJJJ-MM-TT) überschreiben `tage` (1–365); Gegenstellen maskiert.
**Antwort:** `{tage, anzahl, buchungen: [{id, datum, betrag, name, zweck, konto, status, quellId, kategorieId, kategorieName, eingangsbelegId, gebuehr}]}`

### GET /bankbuchung/:id
Einzelne Buchung (voller Datensatz, Gegenstelle maskiert).

### PUT /bankbuchung/:id
Text-Felder korrigieren; Beträge bleiben unverändert.
**Body:** `{name?, zweck?, bemerkung?}` (mindestens eines; `null` leert zweck/bemerkung)
**Antwort:** `{ok: true, id}`

### POST /bankbuchung/:id/status
**Body:** `{status*: "offen"|"ignoriert"}` — zugeordnete Buchungen → 409 (erst Zuordnung lösen).
**Antwort:** `{ok: true, id, status}`

### POST /bankbuchung/:id/kategorie
Einzeler Kontierung.
**Body:** `{kategorieId*: number, notiz?: string}`
**Antwort:** `{ok: true, id, kategorie}`

### POST /bankbuchung/:id/zuordnen
Zahlung zuordnen — Akteptiert ID **oder** Nummer der Ausgangsrechnung, oder Eingangsbeleg-ID. 409 bei Konflikt (z. B. bereits zugeordnet).
**Body:** `{rechnungId: N | nummer: "2026-0042"}` **oder** `{eingangsrechnungId: N}`
**Antwort:** `{ok: true, typ: "ausgang", rechnungId, nummer}` bzw. `{ok: true, typ: "eingang", eingangsrechnungId}`
```json
{"nummer": "2026-0042"}
```

### POST /bankbuchung/:id/loesen
Zuordnung lösen (Reversal).
**Antwort:** `{ok: true}`

### POST /bankbuchung/:id/split
Buchung in Teilbeträge aufspalten (je Teil eigene Kategorie/Zuordnung möglich). Die Teilsumme muss den Buchungsbetrag **exakt** decken (±0,005). Das Original bleibt als ignoriertes Archiv erhalten. Zugeordnete Buchungen → 409 (erst lösen).
**Body:** `{teile*: [{betrag*: number, kategorieId?, name?, bemerkung?}]}` (mindestens 2)
**Antwort:** `{ok: true, originalIgnoriert: id, teile: [neueIds]}`
```json
{"teile": [{"betrag": 80, "kategorieId": 5}, {"betrag": 20, "bemerkung": "Privatanteil"}]}
```

### DELETE /bankbuchung/:id
Buchung löschen — nur nicht zugeordnete/verbuchte (GoBD) → 409 sonst.
**Antwort:** `{ok: true, geloescht: id}`

### POST /bankbuchungen/loeschen
Massen-Löschen; zugeordnete werden übersprungen.
**Body:** `{ids*: [1, 2, 3]}`
**Antwort:** `{ok: true, geloescht, uebersprungen: [ids]}`

### GET /zahlungsabgleich
Offene Buchungen (max. 60) mit Auto-Match-Vorschlag je Buchung.
**Antwort:** `{anzahl, mitVorschlag, buchungen: [{transaktionId, datum, betrag, name, konto, vorschlag: {typ, rechnungOderBeleg, kunde, offenBetrag, sicherheit} | null}]}`

---

## Kontierung & DATEV

### GET /kategorien
**Antwort:** `{anzahl, kategorien: [{id, name, konto, ustSatz, typ: "einnahme"|"ausgabe"}]}`

### POST /kategorie
**Body:** `{name*: string, konto?: string (DATEV-Konto), ustSatz?: 19|7|0, typ?: "einnahme"|"ausgabe" (Default ausgabe)}`
**Antwort:** `{ok: true, id, name}`

### PATCH /kategorie/:id
**Body:** `{name?, konto?, ustSatz?, typ?}` (mindestens eines; `konto: null` leert)
**Antwort:** `{ok: true, id}`

### DELETE /kategorie/:id
Nur wenn keiner Buchung zugeordnet (409 sonst — erst umkategorisieren).
**Antwort:** `{ok: true, geloescht: id}`

### GET /kategorie-regeln
Regel-Engine (Muster → Kategorie), sortiert nach Prio.
**Antwort:** `{regeln: [{id, kategorieId, kategorieName, pattern, feld, prio, …}]}`

### POST /kategorie-regel
**Body:** `{kategorieId*: number, pattern*: string ("Text" oder "A|B|C"), feld?: "name"|"zweck" (Default name), prio?: 1–999 (Default 10)}`
**Antwort:** `{ok: true, id}`

### DELETE /kategorie-regel/:id
**Antwort:** `{ok: true, geloescht: id}`

### POST /bankbuchungen/auto-kategorisieren
Regel-Engine auf alle Buchungen anwenden.
**Antwort:** `{ok: true, kategorisiert, …}` (Ergebnis der Engine)

### POST /bankbuchungen/kategorisieren
Massen-Kontierung; Fehler je Eintrag werden gesammelt (Rest läuft weiter).
**Body:** `{zuordnungen*: [{bankbuchungId*: number, kategorieId*: number, notiz?: string}]}`
**Antwort:** `{ok: true, kategorisiert, fehler: ["#id: grund"]}`

### POST /datev-export
DATEV-Buchungsstapel + Beleg-ZIP für einen Zeitraum. Alias: **`GET /export/datev?von=&bis=`** (identisches Ergebnis).
**Body:** `{von*: "JJJJ-MM-TT", bis*: "JJJJ-MM-TT", nurFreigegebene?: boolean}`
**Antwort:** `{ok: true, dateiname, anzahlBuchungen, hinweise, csvBase64, anzahlBelege, belegeDateiname, belegeZipBase64}`
```json
{"von": "2026-09-01", "bis": "2026-09-30"}
```

---

## Belege (Eingangsrechnungen)

### GET /belege?q=
Beleg-Liste (max. 200, neueste zuerst). `q` durchsucht Lieferant, Nummer **und den persistenten OCR-Text**. Alias: **`GET /eingangsrechnungen`**. Seit v1.21.4 mit `bezahltBetrag` + `offen` je Beleg.
**Antwort:** `{anzahl, belege: [{id, lieferant, nummer, rechnungsdatum, netto, ust, brutto, konto, kategorieId, kategorieName, bezahltAm, bezahltBetrag, offen, hatDatei}]}`

### POST /beleg
Eingangsbeleg anlegen. Alias: **`POST /eingangsrechnung`**. `netto` wird bei Fehlen aus `brutto`/`ustSatz` gerechnet; `konto` aus Kategorie oder Standard-Aufwandskonto. Mit `bankbuchungId` wird sofort verknüpft (= bezahlt markiert).
**Body:** `{lieferant*: string, datum*: "JJJJ-MM-TT", brutto*: number, ustSatz?: 19|7|0 (Default 19), netto?, nummer?, kategorieId?, konto?, faelligkeitsdatum?, lieferantKennung?, typ?: "rechnung"|"gutschrift", waehrung?: "EUR" (3 Buchstaben), betragBank?: number (EUR-Ist bei Fremdwährung), belegBase64?, belegMime?, bankbuchungId?, bemerkung?}`
**Antwort:** `{ok: true, id, nummer, lieferant, brutto, konto, kategorieId, verknuepft}`
```json
{"lieferant": "Bürobedarf Muster GmbH", "datum": "2026-10-15", "brutto": 119.00, "kategorieId": 5, "nummer": "RE-1042"}
```

### GET /beleg/:id/datei
Original-Belegdatei.
**Antwort:** `{ok: true, mime, base64}` — 404 ohne hinterlegte Datei.

### GET /beleg/:id/text
Persistenter OCR-Text; wird bei Bedarf on-demand extrahiert und dauerhaft abgelegt.
**Antwort:** `{ok: true, id, text, quelle: "gespeichert"|"on-demand+gespeichert", methode?, scanHinweis?}` (`scanHinweis: true` bei < 150 Zeichen → manueller Blick)

### POST /beleg/:id/upload
Belegdatei nachträglich anhängen.
**Body:** `{belegBase64*: string, belegMime?: string (Default application/pdf)}`
**Antwort:** `{ok: true, id, mime}`

### POST /beleg/:id/zahlung
(Teil-)Zahlung auf einen Beleg zubuchen (v1.21.4). Default: voller Restbetrag, heute. `bezahltAm` wird gesetzt, sobald `bezahltBetrag` das Brutto erreicht, bei Teilzahlung entfernt. Bereits voll bezahlt → 409 (Korrektur per `PATCH /beleg/:id`).
**Body:** `{betrag?: number, datum?: "JJJJ-MM-TT"}`
**Antwort:** `{ok: true, id, zugebucht, bezahltBetrag, offen, bezahltAm}`

### PATCH /beleg/:id
Zahlungsstand korrigieren (v1.21.4), z. B. falsch als „bezahlt" markierter Beleg mit Rest offen: `{"bezahltBetrag": 100.00}` → `bezahltAm` wird automatisch aufgehoben. Regeln: Nur Datum ohne Betrag = voll bezahlt; `bezahltAm: null` ohne Betrag = komplett unbezahlt; `bezahltBetrag` muss zwischen 0 und brutto liegen; Teilzahlung trägt kein `bezahltAm` (Widerspruch → 400).
**Body:** `{bezahltBetrag?: number, bezahltAm?: "JJJJ-MM-TT"|null, bemerkung?, kategorieId?: number|null, konto?, gegenkonto?, faelligkeitsdatum?: "JJJJ-MM-TT"|null}`
**Antwort:** `{ok: true, id, bezahltBetrag, bezahltAm, offen}`

### POST /beleg/:id/freigabe
Freigabe-Status setzen (audit-logged, GoBD-nachvollziehbar).
**Body:** `{zustand*: "neu"|"geprueft"|"freigegeben"}`
**Antwort:** `{ok: true, id, zustand}`

### DELETE /beleg/:id
Nur **unbezahlte** Belege (Test-/Fehlerfassungen); bezahlte/gebuchte bleiben (GoBD) → 409, Korrektur per Gegenbeleg (`typ: "gutschrift"`).
**Antwort:** `{ok: true, geloescht: id}`

### POST /beleg/extrahieren
OCR + strukturierte Extraktion aus einer Datei (Beleg-Vorentwurf) — danach direkt `POST /beleg` mit den erkannten Werten. Nie 500: Fehler kommen als 422 mit Diagnose.
**Body:** `{base64*: string, mime?: string (Default application/pdf)}`
**Antwort:** `{ok: true, methode, felder: {lieferant?, datum?, brutto?, mwst?, nummer?, iban?} (jedes Feld mit Konfidenz 0–1), textVorschau, scanHinweis}`

---

## Import & Historie

### POST /bankimport
Bankumsätze importieren. Alias: **`POST /bankbuchungen/import`**. Dedup per quell_id + Auto-Match. Drei Wege: `csvText` (direkt), **`csvBase64` (empfohlen**: Rohbytes, serverseitige UTF-8/Windows-1252-Dekodierung — Umlaute bleiben heil) oder `pdfBase64` (SumUp-Kontoauszug). CSV-Formate werden auto-erkannt (inkl. SumUp-Voll/-Bericht).
**Body:** `{bankAccountId*: number, dateiname?: string, csvText?: string | csvBase64?: string | pdfBase64?: string}`
**Antwort (CSV):** `{ok: true, vorlage, importiert, duplikate, uebersprungen, …}`
**Antwort (PDF):** zusätzlich `{uebersprungeneZeilen: […] (max. 20 Rohzeilen zur Diagnose, seit v1.21.4), auszugMeta}`
```json
{"bankAccountId": 1, "dateiname": "umsaetze-oktober.csv", "csvBase64": "QmV3ZWd1bmdzZGF0dW07…"}
```

### GET /bankimporte?bankAccountId=
Letzte 50 Importe (optional pro Konto).
**Antwort:** `{importe: [{id, bankAccountId, dateiname, vorlage, zeilen, duplikate, summeEin, summeAus, erstelltAm}]}`

### DELETE /bankimport/:id
Import samt Buchungen zurücknehmen — nur wenn daraus noch nichts verbucht wurde (GoBD) → 409 sonst.
**Antwort:** `{ok: true, geloescht: id}`

### GET /import-status
Letzter Import + Erinnerungs-Flag (fällig ab 5 Tagen ohne Import).
**Antwort:** `{letzterImport: {datum, dateiname, zeilen} | null, tageSeitImport, erinnerungFaellig}`

---

## Mail

### GET /mails?q=&ordner=&nurUngelesene=&nurMitAnhang=&limit=&offset=&von=&bis=
Mail-Suche (pseudonymisiert). `q` durchsucht betreff, absenderName, absenderAdresse, textPlain (Volltext). `limit` max. 100 (Default 40), `offset` für Pagination, `von`/`bis` JJJJ-MM-TT, `nurUngelesene=1`, `nurMitAnhang=1` (Beleg-Kandidaten).
**Antwort:** `{anzahl, offset, mails: [{id, ordner, betreff, absender, datum, gelesen, anzahlAnhaenge}]}`

### POST /mails/sync
Sofort-Sync (leerer Body = alle Konten). Wasserzeichen-Backfill: lückenlos rückwärts, 50 Mails/Lauf/Ordner — mehrfach aufrufen, bis `GET /mail-ordner` vollständig zeigt.
**Body:** optional `{kontoId?: number, ordner?: string}`
**Antwort:** `{ok: true, konten: [{kontoId, …}]}`

### POST /mails/datum-heilen
Mails ohne Datum bekommen ihr IMAP-Envelope-Datum (Fallback: created_at).
**Antwort:** `{ok: true, …}` (Heilungs-Zähler)

### GET /mail-ordner
Alle Fächer je Konto mit Mail-Anzahl.
**Antwort:** `{ordner: [{kontoId, ordner, anzahl}], gesamt}`

### POST /mail-ordner/erstellen
**Body:** `{kontoId*: number, name*: string}` (Unterordner mit `/`, z. B. `INBOX/Buchhaltung`)
**Antwort:** `{ok: true, …}` — 502 bei IMAP-Fehler.

### POST /mail-ordner/umbenennen
Hängt lokale Mails mit um.
**Body:** `{kontoId*: number, alt*: string, neu*: string}`
**Antwort:** `{ok: true, …}`

### POST /mail-ordner/loeschen
System-Ordner (INBOX, Gesendet, Papierkorb, Spam, Entwürfe, Archiv) sind geschützt.
**Body:** `{kontoId*: number, name*: string}`
**Antwort:** `{ok: true, …}`

### GET /mail/:id
Einzelne Mail (voller Text). Mit `?kurz=1` ohne `textHtml` (Newsletter-Blobs sind 100–600 KB) — stattdessen `htmlVorhanden`/`htmlLaenge`.
**Antwort:** `{id, ordner, betreff, absender, absenderAdresse, datum, gelesen, markiert, textPlain, textHtml, anhaenge: [{name, mime, postEingangId?, …}]}`

### GET /mail/:id/anhang/:index
Anhang als base64 (kann MB groß sein — meist ist `/text` die bessere Wahl).
**Antwort:** `{ok: true, dateiname, mime, base64}`

### GET /mail/:id/anhang/:index/text
**Textinhalt des Anhangs** (PDF via pdftotext, Scan-PDFs automatisch per OCR, Bilder via OCR) — wenige KB statt MB.
**Antwort:** `{ok: true, methode, dateiname, mime, text, scanHinweis}` (`scanHinweis: true` bei < 150 Zeichen OCR-Ertrag → manueller Blick, keine Retries)

### POST /mail/:id/gelesen
**Body:** `{status*: true|false}` (auch `1`/`"true"` akzeptiert)
**Antwort:** `{ok: true, id, gelesen}`

### POST /mail/:id/markierung
Brain-Flag (z. B. Follow-up).
**Body:** `{status*: true|false}`
**Antwort:** `{ok: true, id, markiert}`

### POST /mail/:id/verschieben
Echter IMAP-Move in einen anderen Ordner.
**Body:** `{ordner*: string}` (Ziel)
**Antwort:** `{ok: true, id, ordner}`

### POST /mail/:id/loeschen
Löschen über den Notfall-Löschordner (24 h Aufbewahrung, konfigurierbar) — kein endgültiges Löschen.
**Antwort:** `{ok: true, modus}`

### POST /mail/:id/als-termin
Kalender-Termin direkt aus einer Mail — **idempotent per mailId** (zweiter Call liefert `bereitsVorhanden: true` statt Duplikat).
**Body:** `{datum*: "JJJJ-MM-TT", titel? (Default: Betreff), startZeit?, endZeit? ("SS:MM"), beschreibung?}`
**Antwort:** `{ok: true, id, datum, titel}`
```json
{"datum": "2026-10-28", "startZeit": "10:00", "titel": "Angebotsgespräch Muster GmbH"}
```

### POST /mail/:id/als-entwurf
Antwort-/Weiterleitungs-Entwurf aus einer vorhandenen Mail (Anhänge optional übernommen — „Beleg ans Steuerbüro"). Default-Empfänger: Original-Absender, Default-Betreff: `Re: …`.
**Body:** `{text*: string, empfaenger?, betreff?, mitAnhaengen?: boolean}`
**Antwort:** `{ok: true, id, empfaenger, betreff, anhaengeUebernommen}`

### POST /mail/:id/als-beleg
Eingangsbeleg aus Mail/Anhang anlegen (extrahiert Betrag/Datum automatisch vor).
**Body:** optional `{anhangIndex?: number}`
**Antwort:** `{ok: true, belegId, …}` — 409 mit Klartext-Fehler bei Problemen.

### POST /mail/versenden
Direktversand — **Autonomie-Gate:** vollautomatik ODER Token-Freigabeliste deckt **alle** Empfänger (sonst 403; Alternative: `POST /mail/entwurf`). Signatur wird automatisch angehängt (`mitSignatur: false` deaktiviert).
**Body:** `{empfaenger*: string[] | "a@x, b@y", betreff*: string, text*: string, html?, cc?, bcc?, kontoId?, anhaenge?: [{dateiname, base64, mime?}], inReplyTo?, references?, mitSignatur?: boolean}`
**Antwort:** `{ok: true, via: "vollautomatik"|"freigabeliste"}`

### POST /mail/entwurf
Entwurf in der UI (Verfassen-Tab → Entwürfe-Liste, Badge „KI"). **Der Mensch-Review-Weg: du bereitest vor, der Mensch sendet ab.** Braucht KEINE vollautomatik.
**Body:** `{empfaenger*: string[] | string, betreff*: string, text*: string (oder html), cc?, bcc?, kontoId?, anhaenge?: [{dateiname, base64, mime?}], inReplyTo?, references?}`
**Antwort:** `{ok: true, id, hinweis}`
```json
{"empfaenger": ["kanzlei@example-stb.de"], "betreff": "Belege September", "text": "Anbei die Belege …", "anhaenge": [{"dateiname": "belege.zip", "base64": "…", "mime": "application/zip"}]}
```

### GET /mail-entwuerfe?kontoId=
Entwurfs-Liste (max. 100, zuletzt geändert zuerst).
**Antwort:** `{anzahl, entwuerfe: [{id, empfaenger, cc, bcc, kontoId, betreff, text, anhaenge: [dateinamen], quelle, aktualisiert}]}`

### PATCH /mail-entwurf/:id
Entwurf korrigieren (**Merge** — nur übergebene Felder ändern sich; Bus #169).
**Body:** `{empfaenger?, cc?, bcc?, betreff?, text?, kontoId?, anhaenge?: [{dateiname, base64, mime?}]}`
**Antwort:** `{ok: true, id, aktualisiert: [felder]}`

### DELETE /mail-entwurf/:id
Entwurf verwerfen.
**Antwort:** `{ok: true, verworfen: id}`

### POST /mail-entwurf/:id/senden
Entwurf direkt senden (Gate: vollautomatik ODER Freigabeliste deckt alle Empfänger — sonst 403, Entwurf bleibt). Danach ist der Entwurf gelöscht und die Mail liegt per IMAP-Append im Gesendet-Ordner.
**Antwort:** `{ok: true, via, gesendetAn: […]}`

### GET /versand-log
Letzte 200 Sendungen (Nachweis für Agenten-Versand).
**Antwort:** `{anzahl, sendungen: [{id, belegArt, belegId, empfaenger, betreff, erfolg, fehler, gesendetAm}]}`

---

## Mail-Konten

### GET /mail-konten
Konten ohne Secrets (SMTP-/Signatur-/Abwesenheits-Flags, letzterFehler).
**Antwort:** `{konten: [{id, name, benutzer, host, smtpGesetzt, smtpHost, smtpPort, signaturGesetzt, signaturAntwortGesetzt, abwesenheitAktiv, letzterFehler}]}`

### GET /mail-konto/:id/signatur
**Antwort:** `{ok: true, kontoId, signaturNeu, signaturAntwort}`

### PUT /mail-konto/:id/signatur
**Body:** `{signaturNeu?: string, signaturAntwort?: string}` (mindestens eines)
**Antwort:** `{ok: true, kontoId}`

### POST /mail-konto/:id/smtp-test
SMTP-Verbindungstest (nodemailer verify) — macht fehlende/falsche Zugangsdaten sofort sichtbar.
**Antwort:** `{ok: true, konto}` — 502 mit `fehler` bei Verbindungsproblem.

---

## Kontakte

### GET /kontakte?q=
Kartei; `q` durchsucht name/email/firma.
**Antwort:** `{anzahl, kontakte: [{id, name, email, telefon, firma, notiz, quelle, erstelltVon}]}`

### POST /kontakt
**Body:** `{name*: string, email*: string (muss gültig sein), telefon?, firma?, notiz?}` — 409 bei Duplikat-E-Mail.
**Antwort:** `{ok: true, id, name, email}`

### PUT /kontakt/:id
**Body:** `{name?, email?, telefon?, firma?, notiz?}` (mindestens eines)
**Antwort:** `{ok: true, id}`

### DELETE /kontakt/:id
**Antwort:** `{ok: true, geloescht: id}`

### GET /kontakte-extraktion?kontoId=
**Vorschau**: Kandidaten aus Absender-Metadaten aller Mailkonten (DSGVO-stark: keine Mail-Inhalte) — schreibt nichts.
**Antwort:** `{anzahl, neu, kandidaten: [{email, name, bereitsVorhanden, …}]}`

### POST /kontakte-extraktion
Kuratierte Auswahl aus der Vorschau übernehmen.
**Body:** `{kandidaten*: [{email, name}]}`
**Antwort:** `{ok: true, uebernommen, …}`

---

## Kalender, Fristen & Posteingang

### GET /termine?von=&bis=&mailId=&kundenId=
Termin-Liste (max. 500). `mailId` ist der Idempotenz-Anker: „gibt es zu dieser Mail schon einen Termin?"
**Antwort:** `{anzahl, termine: [{id, titel, datum, startZeit, endZeit, beschreibung, farbe, quelle, mailId, kundenId, erinnereAm, serie, serieId, …}]}`

### POST /termin
Termin anlegen. Mit `serie` werden die nächsten 12 Vorkommen als eigene Termine materialisiert.
**Body:** `{titel*: string, datum*: "JJJJ-MM-TT", startZeit?, endZeit? ("SS:MM"), beschreibung?, farbe?, mailId?, kundenId?, erinnereAm?: "JJJJ-MM-TT SS:MM" (→ ICS-Alarm), serie?: "woechentlich"|"14taegig"|"monatlich"}`
**Antwort:** `{ok: true, id, datum, titel}` — bei Serie zusätzlich `{serie, serieId, vorkommen: 12}`
```json
{"titel": "UStVA abgeben", "datum": "2026-11-10", "erinnereAm": "2026-11-09 09:00"}
```

### PUT /termin/:id
**Body:** `{datum?, startZeit?, endZeit?, titel?, beschreibung?, farbe?}` (mindestens eines)
**Antwort:** `{ok: true, id}`

### DELETE /termin/:id
**Antwort:** `{ok: true, geloescht: id}`

### GET /zahlungsziele?von=&bis=
**Quell-Einträge** aller Fristen: Mahnungen (Stufe+Frist), offene Ausgangsrechnungen, Eingangsrechnungen mit Fälligkeit, Wiedervorlagen/fällige Post — je mit `ueberfaellig`-Flag.
**Antwort:** `{anzahl, ueberfaellig, eintraege: [{…, ueberfaellig}]}`

### GET /posteingang?status=neu|gebucht|abgelegt
Postmanager-Eingänge (max. 100, neueste zuerst).
**Antwort:** `{anzahl, eintraege: [{id, typ, status, stichwort, betrag, faelligAm, wiedervorlageAm, lieferant, quelle, mime, originalname, erstelltAm}]}`

### POST /posteingang/:id/status
Postmanager-Eintrag abhaken.
**Body:** `{status*: "neu"|"gebucht"|"abgelegt"}`
**Antwort:** `{ok: true, id, status}`

### GET /klaerungen?aktiv=1
Offene Klärungsfälle (Rückfragen der Kanzlei an Belege). `aktiv=0` zeigt auch geklärte.
**Antwort:** `{anzahl, klaerungen: [{incomingInvoiceId, frage, antwort, status, lieferant, nummer}]}`

---

## Aufgabenliste

### GET /aufgaben
Wiedervorlage: offene Aufgaben + die letzten 20 erledigten.
**Antwort:** `{offen: [{id, text, faelligAm, prioritaet, …}], erledigt: […]}`

### POST /aufgaben
**Body:** `{text*: string (max. 500), faelligAm?: "JJJJ-MM-TT", prioritaet?: "niedrig"|"normal"|"hoch" (Default normal), referenz?: {art: "mail"|"rechnung"|"beleg", id: number}}`
**Antwort:** `{ok: true, id}`

### POST /aufgaben/:id/erledigt
Schaltet erledigt/offen um (Toggle).
**Antwort:** `{ok: true, erledigt: true|false}`

---

## Statistik, UStVA & Berichte

### GET /statistik/ausgaben?jahr=2026
Ausgaben des Jahres: Eingangsrechnungen + kategorisierte Bank-Ausgaben ohne Beleg (Dedup-Regel wie DATEV), mit Aufschlüsselung `davonBankOhneBeleg`.
**Antwort:** `{jahr, gesamtBrutto, anzahl, davonBankOhneBeleg: {anzahl, brutto}, proMonat: [{monat, brutto}], proKategorie: [{kategorie, brutto}]}`

### GET /ustva?monat=2026-09
UStVA-Zahlen eines Monats (Default: aktueller Monat), gruppiert nach Steuersatz (`satz: -1` = gemischt).
**Antwort:** `{monat, ausgangsrechnungen: [{satz, basis, ust}], eingangsrechnungen: [{satz, basis, ust}], umsatzsteuer, vorsteuer, zahllast}`

### GET /berichte/katalog
Alle 12 Berichte (EÜR, Steuer-Rücklage, ZM, Debitoren/Kreditoren-Aging, Zahlungsverhalten, Kontenblatt, Liquiditäts-Vorschau, SumUp-Gebühren, Fehlende Belege, Ausgaben-Kategorien, Umsatz-Kunden).
**Antwort:** `{berichte: [{id, titel, beschreibung, …}]}`

### GET /berichte/:id?von=&bis=&kontoId=&satz=&format=json|csv|pdf
Bericht als **JSON** (Standard: `{id, titel, spalten, zeilen, summenZeile, zeitraum, …}`), **CSV** oder **PDF** (bei csv/pdf: `{ok, dateiname, base64, mime}`). Kundennamen pseudonymisiert — auch in CSV/PDF. Default-Zeitraum: aktuelles Jahr bis heute.
```json
{"format": "json"}  // GET /berichte/euer?von=2026-01-01&bis=2026-09-30
```

---

## Steuerberater-Paket

### POST /stb-paket
Monatspaket für die Kanzlei: DATEV-Stapel + Beleg-ZIP (mit document.xml, DATEV XML-Schnittstelle) + EÜR/Debitoren/Kreditoren-PDFs — als fertiger Anhang-Satz, direkt in `POST /mail/entwurf` weiterverwendbar.
**Body:** `{von*: "JJJJ-MM-TT", bis*: "JJJJ-MM-TT"}`
**Antwort:** `{ok: true, anhaenge: [{dateiname, base64, mime}], kanzleiAdresse, hinweis}`
```json
{"von": "2026-09-01", "bis": "2026-09-30"}
```

---

## Transparenz & Vertrauen

### GET /audit-log?von=&bis=&aktion=&limit=
Jede Agent-Aktion mit Zeitstempel + Details (GoBD-relevant). `limit` max. 500 (Default 200).
**Antwort:** `{anzahl, eintraege: [{id, aktion, details, zeit}]}`

### Idempotenz (alle POST-Endpunkte)
Header `Idempotenz-Key: <beliebig>` bei jedem POST → Timeout-Retry liefert die gespeicherte Antwort (`x-idempotent-replay: 1`), nichts wird doppelt ausgeführt.

### GET /webhooks
**Antwort:** `{anzahl, webhooks: [{id, ereignis, url, …}]}`

### POST /webhooks
Echtzeit statt Polling: POST JSON an die URL bei Ereignis (5 s Timeout, Fehlerzähler).
**Body:** `{ereignis*: "mail.neu"|"bankbuchung.neu", url*: "https://…"}`
**Antwort:** `{ok: true, id}`

### DELETE /webhooks/:id
**Antwort:** `{ok: true, geloescht: id}`

---

## Autonomie-Stufen (Einstellungen → Agent-API)
- `vorschlag` (Standard): Lesen + Entwürfe/Aufgaben/Kategorien/Belege — **Mail-Entwürfe gehen immer** (der Mensch sendet).
- `vollautomatik`: zusätzlich Direktversand (Rechnungen, Mails).
- **Feinjustage pro Token** (ab 1.17): Token-Feld `freigabeEmpfaenger` (JSON-Array mit Adressen oder `@domain`) erlaubt Direktversand an genau diese Empfänger auch in Stufe `vorschlag` — Routinepost direkt, Sensibles bleibt Entwurf. Nachweis: `GET /versand-log` + `GET /audit-log`.

---

## Optimale Nutzungs-Wege für Agenten

Konkrete Workflows mit Endpunkt-Sequenzen (Musterdaten, keine echten Kundendaten):

### 1. Morgen-Briefing / Tagesstart
`GET /uebersicht/heute` → bei Bedarf gezielt nachfassen: `GET /zahlungsziele` (Fristen), `GET /mails?nurUngelesene=1` (Posteingang), `GET /bankbuchungen?…` (offene Buchungen). Ein Call statt Dauerfeuer.

### 2. Beleg aus Mail archivieren
`GET /mails?nurMitAnhang=1&q=rechnung` → `GET /mail/:id?kurz=1` (Kontext) → `GET /mail/:id/anhang/:index/text` (OCR, wenige KB) → `POST /mail/:id/als-beleg {anhangIndex}` (legt Beleg an, extrahiert Betrag/Datum) → prüfen per `GET /belege?q=<lieferant>` → ggf. `PATCH /beleg/:id` (kategorieId/faelligkeitsdatum) → `POST /beleg/:id/freigabe {zustand: "geprueft"}` → `POST /mail/:id/verschieben {ordner: "INBOX/Buchhaltung"}` + `POST /mail/:id/gelesen {status: true}`.

### 3. Zahlungsabgleich automatisieren
`GET /zahlungsabgleich` → je Buchung mit `vorschlag` (hohe `sicherheit`): `POST /bankbuchung/:id/zuordnen {nummer}` → verifizieren per `GET /rechnung/:id/zahlungen` (`differenzManuell` sollte 0 sein) → Rest kategorisieren: `POST /bankbuchung/:id/kategorie {kategorieId}` oder `POST /bankbuchung/:id/split` bei gemischten Zahlungen.

### 4. Rechnung aus Entwurf finalisieren und versenden
`GET /entwuerfe` → `GET /rechnung/:id` (Positionen prüfen) → ggf. `PATCH /rechnung-entwurf/:id {rechnungsdatum, faelligkeitsdatum}` (Bus #191) → `POST /rechnung/:id/finalisieren` → `GET /rechnung/:id/pdf` → Versand per `POST /rechnung/:id/versenden` (vollautomatik) **oder** Mensch-Review: `POST /mail/entwurf {anhaenge: [{dateiname, base64, mime}]}`.

### 5. Mahnwesen
`GET /mahnungen` → je Fall `POST /mahnung {rechnungId, stufe}` (Agent legt an, Mensch versendet) → Wiedervorlage: `POST /aufgaben {text: "Mahnung 2026-0042: Zahlungseingang prüfen", faelligAm, referenz: {art: "rechnung", id}}`.

### 6. Bankimport + Auto-Kategorisierung
`GET /kontostand` (bankAccountId holen) → `POST /bankimport {bankAccountId, csvBase64}` → `POST /bankbuchungen/auto-kategorisieren` → Rest manuell: `GET /bankbuchungen?…` → `POST /bankbuchungen/kategorisieren {zuordnungen: […]}` → `GET /import-status` als Abschluss-Check.

### 7. Monatspaket an die Kanzlei
`POST /stb-paket {von, bis}` → `POST /mail/entwurf {empfaenger: [kanzleiAdresse], anhaenge: <aus stb-paket>}` → Mensch prüft und sendet. Optional Nachweis: `GET /versand-log`.

### 8. Termin aus Mail mit Wiedervorlage
`GET /mails?q=termin` → `GET /termine?mailId=<id>` (Idempotenz prüfen!) → `POST /mail/:id/als-termin {datum, titel, startZeit}` → Antwort vorbereiten: `POST /mail/:id/als-entwurf {text}`.

### 9. UStVA-Monatscheck
`GET /ustva?monat=JJJJ-MM` → `GET /berichte/euer?von=&bis=` (Detailnachweis) → Abweichungen: `GET /belege?q=` / `GET /rechnungen?von=&bis=` → Ergebnis als Aufgabe: `POST /aufgaben {text: "UStVA 09/2026: Zahllast 1.234,56 EUR prüfen"}`.

### 10. Neuer Kunde → erste Rechnung
`GET /kunde/nach-name/:name` (Dubletten-Check) → `POST /kunde {name, email, ort}` → `GET /leistungskatalog` (Preise) → `POST /rechnung-entwurf {kundenId, items}` → Workflow 4 (finalisieren/versenden).

---

## Token-Sparsamkeit (Harness-Disziplin — NVIDIA SoL-Pi-Konsens)

Die API ist darauf ausgelegt, Kontext klein zu halten. Nutze sie so:

1. **Morgen-Briefing statt Dauerfeuer**: Starte Sessions mit `GET /uebersicht/heute` (1 Call) statt 8+ Einzelabfragen. Danach nur noch gezielt nachfassen.
2. **Übersichten statt Pagination**: `GET /mail-ordner` (Zähler je Fach) + `von`/`bis`-Fenster statt blindem Durchblättern. `limit=100` + `offset` nur für echte Scans.
3. **`kurz=1` als Standard**: `GET /mail/:id?kurz=1` (kein HTML-Blob) — `textHtml` nur holen, wenn du es wirklich brauchst (Newsletter sind 100–600 KB).
4. **Anhang-Text statt Datei**: `GET /mail/:id/anhang/:index/text` (OCR-Text, wenige KB) statt `anhang/:index` (base64, oft MB). `scanHinweis: true` = manueller Blick, keine Retries.
5. **Berichte statt Rohdaten**: `GET /berichte/:id` (fertig aggregiert) statt alle Rechnungen/Buchungen selbst zu summieren. PDF/CSV nur bei echtem Bedarf.
6. **Pseudonym-Listen statt Detail-Kaskaden**: `/kunde/nach-email` (ID holen) → gezielte Folgeabfragen — nicht `/kunden` komplett + `/rechnung/:id` für alle.
7. **Keine Re-Fetches**: `docs/agent-api.md` und `/berichte/katalog` ändern sich selten — cachen pro Session statt wiederholt ziehen.
8. **Schreiben mit Idempotenz**: `Idempotenz-Key`-Header statt Retry-Schleifen — ein Timeout kostet sonst doppelt Tokens UND Aktionen.

> Hintergrund (Studie „SoL-Pi", Nvidia 2026): Die größten Token-Einsparungen entstehen nicht am Modell, sondern am Harness — Kontext kompakt halten, lange Tool-Ausgaben archivieren statt wiederholen, Schritte bündeln. Diese Endpunkte sind genau dafür gebaut.

---

## Stolpersteine (FAQ)
- **Windows-curl**: einfache Anführungszeichen um JSON funktionieren in cmd.exe **nicht** → Body kommt leer an (400/404 mit Echo der empfangenen Felder). Doppelte Anführungszeichen + Escape (`\"`) oder Body-Datei (`--data @body.json`) verwenden. **Auf Linux/Mac ist `'…'` korrekt.**
- **id vs. nummer**: Endpunkte mit `:id` erwarten die numerische ID. Wo Nummern akzeptiert werden (`POST /bankbuchung/:id/zuordnen`, `POST /rechnung-entwurf`, `POST /mahnung`), steht es explizit dabei.
- **403 bei Versand**: `POST /rechnung/:id/versenden`, `POST /mail/versenden` und `POST /mail-entwurf/:id/senden` brauchen Autonomie-Stufe **vollautomatik** oder eine passende Token-Freigabeliste (Einstellungen → Agent-API). Alternative immer: `POST /mail/entwurf` (Mensch-Review).
- **409 bei Entwürfen**: Entwürfe haben keine Nummer und kein PDF — erst `POST /rechnung/:id/finalisieren` (oder `typ: "proforma"`). Korrigieren geht nur im Entwurfsstatus: `PATCH /rechnung-entwurf/:id`.
- **Alias-Regel**: Wo Aliase existieren (`/bankbuchungen/import`, `/eingangsrechnung(en)`, `/export/datev`), liefern beide Pfade dasselbe — 404 heißt: Instanz läuft noch auf altem Stand.
