# ReWaWi Agent-API — Leitfaden (Stand v1.16.6)

REST-API für externe Agenten (Kimi Claw). Basis: `https://<host>/api/agent`
Auth: `Authorization: Bearer ax_…` (Token aus Einstellungen → Agent-API, Klartext nur einmalig).
Fehler: `{"ok": false, "fehler": "Klartext"}` mit HTTP-Status 400/401/403/404/409/502.
DSGVO: Namen erscheinen pseudonymisiert (K-/L-Nummern), Bank-Gegenstellen maskiert.

## Status & Heartbeat
- `GET /status` → `{produkt, version, zeit}`

## Rechnungen
- `GET /offene-rechnungen` → offene + überfällige (Kunde, Betrag, Fälligkeit)
- `GET /entwuerfe` → Entwürfe
- `GET /rechnung/:id` → Einzelrechnung mit Positionen
- `GET /rechnung/:id/zahlungen` → zugeordnete Bankbuchungen + `differenzManuell` (manuell gebucht ohne Bankzuordnung)
- `GET /kunden-ohne-rechnung?tage=30`
- `GET /mahnungen` → fällige Mahnstufen · `POST /mahnung {rechnungId|nummer}` → nächste Stufe · `DELETE /mahnung/:id` (irrtümliche)
- `POST /kunde` → Quick-Add `{name, email?, strasse?, plz?, ort?}`
- `GET /kunden` · `GET /kunde/:id` · `PUT /kunde/:id`
- `POST /rechnung-entwurf` → `{"kunde":"Name"|"kundenId":N|"id":N, "items":[{"bezeichnung","menge"?,"einzelpreis","ustSatz"?}], "pdfNotiz"?}` → Entwurf (Mensch gibt frei)
- `DELETE /entwurf/:id` → nur Entwürfe (GoBD)
- `POST /rechnung/:id/zahlung` → Zahlung registrieren `{betrag?, datum?}`
- `POST /rechnung/:id/stornieren` → GoBD-Gutschrift
- `POST /rechnung/:id/versenden` → Mail mit PDF (+XRechnung) — nur Stufe **vollautomatik**
- `GET /leistungskatalog` → aktive Produkte (Preise/USt)

## Banking
- `GET /kontostand` → je Konto `{kontoId, bezeichnung, iban, saldo, quelle}` — **hier findest du die bankAccountId** (SumUp: IBAN beginnt mit IE10SUMU…)
- `GET /bankbuchungen?tage=30` · `GET /bankbuchung/:id` · `PUT /bankbuchung/:id`
- `GET /zahlungsabgleich` → offene Buchungen mit Auto-Match-Vorschlag
- `POST /bankbuchung/:id/zuordnen` `{rechnungId|nummer}` oder `{eingangsrechnungId}`
- `POST /bankbuchung/:id/loesen` → Reversal
- `POST /bankbuchung/:id/split` `{teile:[{betrag,kategorieId?}]}` (Summe muss decken)
- `DELETE /bankbuchung/:id` · `POST /bankbuchungen/loeschen {ids}` (nur nicht zugeordnete)
- `POST /bankbuchung/:id/status` `{offen|ignoriert}`

## Kontierung & DATEV
- `GET/POST/PATCH/DELETE /kategorie(n)`
- `POST /bankbuchung/:id/kategorie` · `POST /bankbuchungen/kategorisieren` (Massen)
- `GET/POST/DELETE /kategorie-regel[n]` + `POST /bankbuchungen/auto-kategorisieren`
- `POST /datev-export {von,bis}` → `{dateiname, anzahlBuchungen, csvBase64}` (Alias: `GET /export/datev?von=&bis=`)

## Belege (Eingangsrechnungen)
- `POST /beleg` → `{lieferant*, datum*, brutto*, kategorieId?, konto?, nummer?, belegBase64?, belegMime?, bankbuchungId?}` (Alias: `/eingangsrechnung`)
- `GET /belege` (Alias: `/eingangsrechnungen`) · `GET /beleg/:id/datei`
- `POST /beleg/:id/upload` → Datei nachträglich

## Import & Historie
- `POST /bankimport` **oder Alias `/bankbuchungen/import`** → CSV `{"bankAccountId","dateiname","csvText"}` **oder** PDF `{"bankAccountId","pdfBase64"}` → Dedup (quell_id) + Auto-Match
- `GET /bankimporte` · `DELETE /bankimport/:id` · `GET /import-status` → letzte Läufe/Zählstände

## Mail (ab 1.16)
- `GET /mails?q=&ordner=&nurUngelesene=&nurMitAnhang=&limit=&offset=&von=&bis=` (pseudonymisiert) — `limit` max 100, `offset` für Pagination, `von`/`bis` als JJJJ-MM-TT (inklusive, kombinierbar mit q), `nurMitAnhang=1` nur Mails mit Dateianhängen (Beleg-Kandidaten)
- `POST /mails/sync` → sofort-Sync aller Konten. Der Backfill arbeitet mit Wasserzeichen lückenlos rückwärts (neueste → älteste, 50/Lauf/Ordner) — bei Bedarf mehrfach aufrufen, bis `GET /mail-ordner` die erwarteten Stände zeigt. Kann >1 min dauern.
- `GET /mail-ordner` → alle Fächer je Konto mit Mail-Anzahl (`[{kontoId, ordner, anzahl}], gesamt`) — kein Raten mehr
- `GET /mail/:id` · `GET /mail/:id?kurz=1` (ohne textHtml, dafür `htmlVorhanden`/`htmlLaenge` — Newsletter-Blobs bleiben draußen) · `GET /mail/:id/anhang/:index` (base64)
- `GET /mail/:id/anhang/:index/text` → **Textinhalt des Anhangs** (PDF via pdftotext, **Scan-PDFs automatisch per OCR** (pdftoppm+tesseract, erste 8 Seiten), Bilder via OCR)
- `POST /mails/datum-heilen` → Mails ohne Datum bekommen ihr IMAP-Envelope-Datum nachgepflegt (Fallback: created_at) → `{geprueft, geheilt, fehler}`
- `POST /mail/versenden` `{empfaenger[], cc?, bcc?, kontoId?, betreff, text, html?, anhaenge?, inReplyTo?, references?}` — nur **vollautomatik**
- `POST /mail/:id/als-beleg` `{anhangIndex?}` → Eingangsbeleg aus Mail/Anhang

## Kontakte (ab 1.16.3)
- `GET /kontakte?q=` → Kartei (id, name, email, telefon, firma, notiz, quelle)
- `POST /kontakt {name*, email*, telefon?, firma?, notiz?}` (409 bei Duplikat-E-Mail) · `PUT /kontakt/:id` · `DELETE /kontakt/:id`
- `GET /kontakte-extraktion?kontoId=` → **Vorschau**: Kandidaten aus Absender-Metadaten aller Mailkonten (DSGVO-stark: keine Mail-Inhalte), mit `bereitsVorhanden`-Markierung — schreibt nichts
- `POST /kontakte-extraktion {kandidaten:[{email, name}]}` → kuratierte Auswahl aus der Vorschau übernehmen

## Kalender & Fristen (ab 1.16.4/1.16.5)
- `GET /termine?von=&bis=&mailId=` · `POST /termin {titel*, datum* (JJJJ-MM-TT), startZeit?/endZeit? (SS:MM), beschreibung?, farbe?, mailId?}` · `PUT /termin/:id` · `DELETE /termin/:id` — **Idempotenz:** vor dem Anlegen `GET /termine?mailId=<id>` prüfen, damit aus einer Mail nicht zwei Termine entstehen
- `GET /zahlungsziele?von=&bis=` → **Quell-Einträge**: Mahnungen (Stufe+Frist), offene Ausgangsrechnungen, Eingangsrechnungen mit Fälligkeit, Wiedervorlagen/fällige Posts — je mit `ueberfaellig`-Flag
- `GET /posteingang?status=neu|gebucht|abgelegt` → Postmanager-Eingänge (typ, Lieferant, Betreff)

## Autonomie-Stufen (Einstellungen → Agent-API)
- `vorschlag` (Standard): Lesen + Entwürfe/Aufgaben/Kategorien/Belege
- `vollautomatik`: zusätzlich Versand (Rechnungen, Mails)

## Statistik & UStVA
- `GET /statistik/ausgaben?jahr=2026` (Eingangsrechnungen + kategorisierte Bank-Ausgaben ohne Beleg, Aufschlüsselung `davonBankOhneBeleg`)
- `GET /ustva?monat=2026-09`

## Aufgabenliste
- `GET/POST /aufgaben` · `POST /aufgaben/:id/erledigt`

## Stolpersteine (FAQ)
- **Windows-curl**: einfache Anführungszeichen um JSON funktionieren in cmd.exe **nicht** → Body kommt leer an (400/404 mit Echo der empfangenen Felder). Doppelte Anführungszeichen + Escape (`\"`) oder Body-Datei (`--data @body.json`) verwenden. **Auf Linux/Mac ist `'…'` korrekt.**
- **id vs. nummer**: Endpunkte mit `:id` erwarten die numerische ID. Wo Nummern akzeptiert werden (zuordnen, rechnung-entwurf, mahnung), steht es explizit dabei.
- **403 bei Versand**: `/rechnung/:id/versenden` und `/mail/versenden` brauchen Autonomie-Stufe **vollautomatik** (Einstellungen → Agent-API).
- **Alias-Regel**: Wo Aliase existieren (`/bankbuchungen/import`, `/eingangsrechnung(en)`, `/export/datev`), liefern beide Pfade dasselbe — 404 heißt: Instanz läuft noch auf altem Stand.
