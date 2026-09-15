# ReWaWi Agent-API — Leitfaden (Stand v1.16.x)

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
- `GET /mahnungen` → fällige Mahnstufen
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
- `GET /bankimporte` · `DELETE /bankimport/:id`

## Mail (ab 1.16)
- `GET /mails?q=&ordner=&nurUngelesene=&limit=` (pseudonymisiert)
- `GET /mail/:id` · `GET /mail/:id/anhang/:index` (base64)
- `POST /mail/versenden` `{empfaenger[], cc?, bcc?, kontoId?, betreff, text, html?, anhaenge?, inReplyTo?, references?}` — nur **vollautomatik**
- `POST /mail/:id/als-beleg` `{anhangIndex?}` → Eingangsbeleg aus Mail/Anhang

## Autonomie-Stufen (Einstellungen → Agent-API)
- `vorschlag` (Standard): Lesen + Entwürfe/Aufgaben/Kategorien/Belege
- `vollautomatik`: zusätzlich Versand (Rechnungen, Mails)

## Statistik & UStVA
- `GET /statistik/ausgaben?jahr=2026` (Eingangsrechnungen + kategorisierte Bank-Ausgaben ohne Beleg, Aufschlüsselung `davonBankOhneBeleg`)
- `GET /ustva?monat=2026-09`

## Aufgabenliste
- `GET/POST /aufgaben` · `POST /aufgaben/:id/erledigt`
