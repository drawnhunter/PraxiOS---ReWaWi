# ReWaWi Agent-API — Leitfaden (Stand v1.18.0)

REST-API für externe Agenten (Kimi Claw). Basis: `https://<host>/api/agent`
Auth: `Authorization: Bearer ax_…` (Token aus Einstellungen → Agent-API, Klartext nur einmalig).
Fehler: `{"ok": false, "fehler": "Klartext"}` mit HTTP-Status 400/401/403/404/409/502.
DSGVO: Namen erscheinen pseudonymisiert (K-/L-Nummern), Bank-Gegenstellen maskiert.

## Status & Heartbeat
- `GET /status` → `{produkt, version, zeit}`

## Rechnungen
- `GET /offene-rechnungen` → offene + überfällige (Kunde, Betrag, Fälligkeit)
- `GET /rechnungen?q=&von=&bis=&status=` → Suche (Nummer-Teilstring, Zeitraum, Status)
- `GET /entwuerfe` → Entwürfe
- `GET /rechnung/:id` → Einzelrechnung mit Positionen
- `GET /rechnung/:id/pdf` → **Rechnungs-PDF als base64** (dasselbe GoBD-PDF wie der UI-Download; Entwürfe → 409)
- `GET /rechnung/:id/zahlungen` → zugeordnete Bankbuchungen + `differenzManuell` (manuell gebucht ohne Bankzuordnung)
- `GET /kunden-ohne-rechnung?tage=30`
- `GET /mahnungen` → fällige Mahnstufen · `POST /mahnung {rechnungId|nummer}` → nächste Stufe · `DELETE /mahnung/:id` (irrtümliche)
- `POST /kunde` → Quick-Add `{name, email?, strasse?, plz?, ort?}`
- `GET /kunden` · `GET /kunde/:id` · `PUT /kunde/:id`
- **`GET /kunde/nach-email/:email`** → `{kundenId, pseudonym, ort}` — Zuordnung Mail↔Kunde ohne Klartext-Leak
- **`GET /kunde/nach-name/:name`** → bis zu 5 Kandidaten (fuzzy, `{kundenId, pseudonym, ort, score}`)
- **`GET /kunde/:id/rechnungen`** → ALLE Rechnungen des Kunden (Status, brutto, bezahlt, offen)
- `POST /rechnung-entwurf` → `{"kunde":"Name"|"kundenId":N|"id":N, "items":[{"bezeichnung","menge"?,"einzelpreis","ustSatz"?}], "pdfNotiz"?}` → Entwurf (Mensch gibt frei)
- `DELETE /entwurf/:id` → nur Entwürfe (GoBD)
- `POST /rechnung/:id/zahlung` → Zahlung registrieren `{betrag?, datum?}`
- `POST /rechnung/:id/stornieren` → GoBD-Gutschrift
- `POST /rechnung/:id/versenden {empfaenger?, betreff?, text?}` → Mail mit PDF — **vollautomatik** ODER Token-Freigabeliste (s. Autonomie)
- `GET /leistungskatalog` → aktive Produkte (Preise/USt)

## Banking
- `GET /kontostand` → je Konto `{kontoId, bankAccountId (Alias), bezeichnung, iban, saldo, quelle}` — **hier findest du die bankAccountId** (SumUp: IBAN beginnt mit IE10SUMU…)
- `GET /bankbuchungen?tage=30&q=&von=&bis=&betragMin=&betragMax=&kontoId=` — q durchsucht Name+Zweck, von/bis (JJJJ-MM-TT) überschreibt tage · `GET /bankbuchung/:id` · `PUT /bankbuchung/:id`
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
- `POST /bankimport` **oder Alias `/bankbuchungen/import`** → CSV `{"bankAccountId","dateiname","csvText"}` **oder** `{"bankAccountId","csvBase64"}` (**empfohlen**: Rohbytes, serverseitig UTF-8/Windows-1252-Dekodierung — Umlaute bleiben heil) **oder** PDF `{"bankAccountId","pdfBase64"}` → Dedup (quell_id) + Auto-Match
- `GET /bankimporte` · `DELETE /bankimport/:id` · `GET /import-status` → letzte Läufe/Zählstände

## Beleg-Extraktion (OCR → strukturierte Felder)
- `POST /beleg/extrahieren {base64, mime}` → `{methode, felder: {lieferant?, datum?, brutto?, mwst?, nummer?, iban?}, textVorschau}` — jedes Feld mit Konfidenz 0–1; danach direkt `POST /beleg` mit den erkannten Werten

## Mail (ab 1.16, erweitert 1.17)
- `GET /mails?q=&ordner=&nurUngelesene=&nurMitAnhang=&limit=&offset=&von=&bis=` (pseudonymisiert) — **q durchsucht: betreff, absenderName, absenderAdresse, textPlain (Volltext)** · `limit` max 100, `offset` für Pagination, `von`/`bis` JJJJ-MM-TT, `nurMitAnhang=1` Beleg-Kandidaten
- `POST /mails/sync {kontoId?, ordner?}` → sofort-Sync (gezielt pro Konto/Ordner möglich). Wasserzeichen-Backfill: lückenlos rückwärts, 50/Lauf/Ordner — mehrfach aufrufen, bis `GET /mail-ordner` vollständig zeigt
- `GET /mail-ordner` → alle Fächer je Konto mit Mail-Anzahl
- **`POST /mail-ordner/erstellen {kontoId, name}`** (Unterordner mit `/`, z. B. `INBOX/Buchhaltung`) · **`POST /mail-ordner/umbenennen {kontoId, alt, neu}`** (hängt lokale Mails um) · **`POST /mail-ordner/loeschen {kontoId, name}`** — System-Ordner (INBOX, Gesendet, Papierkorb, Spam, Entwürfe, Archiv) sind geschützt
- `GET /mail/:id` · `GET /mail/:id?kurz=1` (ohne textHtml, dafür `htmlVorhanden`/`htmlLaenge`) · `GET /mail/:id/anhang/:index` (base64)
- `GET /mail/:id/anhang/:index/text` → **Textinhalt des Anhangs** (PDF via pdftotext, Scan-PDFs automatisch per OCR, Bilder via OCR)
- `POST /mails/datum-heilen` → Mails ohne Datum bekommen IMAP-Envelope-Datum (Fallback: created_at)
- **`POST /mail/entwurf {empfaenger[], cc?, bcc?, kontoId?, betreff, text|html, anhaenge?[{dateiname,base64,mime}], inReplyTo?, references?}`** → Entwurf in der UI (Verfassen-Tab → Entwürfe-Liste, Badge „KI"). **Der Mensch-Review-Weg: du bereitest vor, der Mensch sendet ab.** Braucht KEINE vollautomatik.
- `GET /mail-entwuerfe?kontoId=` → Liste · `DELETE /mail-entwurf/:id`
- **`POST /mail-entwurf/:id/senden`** → Entwurf direkt senden (Gate: vollautomatik ODER Freigabeliste deckt alle Empfänger) — danach ist der Entwurf gelöscht und die Mail liegt im Gesendet-Ordner (IMAP-Append, sofort sichtbar)
- **`POST /mail/:id/als-entwurf {empfaenger?, betreff?, text, mitAnhaengen?}`** → Antwort-/Weiterleiten-Entwurf aus vorhandener Mail (Anhänge optional übernommen — „Beleg ans Steuerbüro")
- `POST /mail/:id/gelesen {status}` · `POST /mail/:id/markierung {status}` (Brain-Flag) · `POST /mail/:id/verschieben {ordner}` (echter IMAP-Move)
- `POST /mail/:id/als-termin {datum*, titel?, startZeit?, endZeit?}` → Kalender-Termin aus Mail (idempotent per mailId)
- `POST /mail/versenden` `{empfaenger[], cc?, bcc?, kontoId?, betreff, text, html?, anhaenge?[{dateiname,base64,mime}], inReplyTo?, references?}` — **vollautomatik** ODER Token-Freigabeliste
- `POST /mail/:id/als-beleg` `{anhangIndex?}` → Eingangsbeleg aus Mail/Anhang
- `GET /versand-log` → letzte 200 Sendungen (Empfänger, Betreff, Erfolg, Zeit)

## Kontakte (ab 1.16.3)
- `GET /kontakte?q=` → Kartei (id, name, email, telefon, firma, notiz, quelle)
- `POST /kontakt {name*, email*, telefon?, firma?, notiz?}` (409 bei Duplikat-E-Mail) · `PUT /kontakt/:id` · `DELETE /kontakt/:id`
- `GET /kontakte-extraktion?kontoId=` → **Vorschau**: Kandidaten aus Absender-Metadaten aller Mailkonten (DSGVO-stark: keine Mail-Inhalte), mit `bereitsVorhanden`-Markierung — schreibt nichts
- `POST /kontakte-extraktion {kandidaten:[{email, name}]}` → kuratierte Auswahl aus der Vorschau übernehmen

## Kalender & Fristen (ab 1.16.4/1.16.5, erweitert 1.17)
- `GET /termine?von=&bis=&mailId=&kundenId=` · `POST /termin {titel*, datum* (JJJJ-MM-TT), startZeit?/endZeit? (SS:MM), beschreibung?, farbe?, mailId?, kundenId?, erinnereAm? ("JJJJ-MM-TT SS:MM" → ICS-Alarm), serie? ("woechentlich"|"14taegig"|"monatlich" → nächste 12 Vorkommen werden angelegt)}` · `PUT /termin/:id` · `DELETE /termin/:id` — **Idempotenz:** vor dem Anlegen `GET /termine?mailId=<id>` prüfen
- `GET /zahlungsziele?von=&bis=` → **Quell-Einträge**: Mahnungen (Stufe+Frist), offene Ausgangsrechnungen, Eingangsrechnungen mit Fälligkeit, Wiedervorlagen/fällige Posts — je mit `ueberfaellig`-Flag
- `GET /posteingang?status=neu|gebucht|abgelegt` → Postmanager-Eingänge (typ, Lieferant, Betreff)

## Autonomie-Stufen (Einstellungen → Agent-API)
- `vorschlag` (Standard): Lesen + Entwürfe/Aufgaben/Kategorien/Belege — **Mail-Entwürfe gehen immer** (der Mensch sendet)
- `vollautomatik`: zusätzlich Direktversand (Rechnungen, Mails)
- **Feinjustage pro Token** (ab 1.17): Token-Feld `freigabeEmpfaenger` (JSON-Array mit Adressen oder `@domain`) erlaubt Direktversand an genau diese Empfänger auch in Stufe `vorschlag` — Routinepost direkt, Sensibles bleibt Entwurf. Nachweis: `GET /versand-log` + `GET /audit-log`.

## Transparenz & Vertrauen (ab 1.17)
- `GET /audit-log?von=&bis=&aktion=&limit=` → jede Agent-Aktion mit Zeitstempel + Details (GoBD-relevant)
- **Idempotenz**: Header `Idempotenz-Key: <beliebig>` bei jedem POST → Timeout-Retry liefert die gespeicherte Antwort (`x-idempotent-replay: 1`), nichts dupliziert
- **Webhooks**: `POST /webhooks {ereignis: "mail.neu"|"bankbuchung.neu", url}` → POST JSON bei Ereignis (5s Timeout, Fehlerzähler) · `GET /webhooks` · `DELETE /webhooks/:id`

## Steuerberater-Paket (ab 1.18)
- `POST /stb-paket {von, bis}` → `{anhaenge: [{dateiname, base64, mime}], kanzleiAdresse}` — DATEV-Stapel + Beleg-ZIP (mit document.xml, DATEV XML-Schnittstelle) + EÜR/OP-Listen-PDFs. Direkt als `anhaenge` in `POST /mail/entwurf` weiterverwendbar.

## Berichte (ab 1.17.5)
- `GET /berichte/katalog` → alle 12 Berichte (EÜR, Steuer-Rücklage, ZM, Debitoren/Kreditoren-Aging, Zahlungsverhalten, Kontenblatt, Liquiditäts-Vorschau, SumUp-Gebühren, Fehlende Belege, Ausgaben-Kategorien, Umsatz-Kunden)
- `GET /berichte/:id?von=&bis=&kontoId=&satz=&format=` → Bericht als **JSON** (Standard), **CSV** oder **PDF** (`format=json|csv|pdf` → bei csv/pdf `{dateiname, base64, mime}`) — Kundennamen pseudonymisiert. **StB-Workflow:** Bericht als PDF → `POST /mail/entwurf` mit `anhaenge:[{dateiname, base64, mime}]` → Mensch prüft & sendet

## Morgen-Briefing (ab 1.17)
- `GET /uebersicht/heute` → ein Call: überfällige Zahlungsziele, heutige Termine, neue/ungelesene Mails, offene Bankbuchungen ohne Zuordnung, offene Aufgaben

## Statistik & UStVA
- `GET /statistik/ausgaben?jahr=2026` (Eingangsrechnungen + kategorisierte Bank-Ausgaben ohne Beleg, Aufschlüsselung `davonBankOhneBeleg`)
- `GET /ustva?monat=2026-09`

## Aufgabenliste (Wiedervorlage, erweitert 1.17)
- `GET/POST /aufgaben {text*, faelligAm? (JJJJ-MM-TT), prioritaet? (niedrig|normal|hoch), referenz? {art: "mail"|"rechnung"|"beleg", id}}` · `POST /aufgaben/:id/erledigt`

## Stolpersteine (FAQ)
- **Windows-curl**: einfache Anführungszeichen um JSON funktionieren in cmd.exe **nicht** → Body kommt leer an (400/404 mit Echo der empfangenen Felder). Doppelte Anführungszeichen + Escape (`\"`) oder Body-Datei (`--data @body.json`) verwenden. **Auf Linux/Mac ist `'…'` korrekt.**
- **id vs. nummer**: Endpunkte mit `:id` erwarten die numerische ID. Wo Nummern akzeptiert werden (zuordnen, rechnung-entwurf, mahnung), steht es explizit dabei.
- **403 bei Versand**: `/rechnung/:id/versenden` und `/mail/versenden` brauchen Autonomie-Stufe **vollautomatik** (Einstellungen → Agent-API).
- **Alias-Regel**: Wo Aliase existieren (`/bankbuchungen/import`, `/eingangsrechnung(en)`, `/export/datev`), liefern beide Pfade dasselbe — 404 heißt: Instanz läuft noch auf altem Stand.
