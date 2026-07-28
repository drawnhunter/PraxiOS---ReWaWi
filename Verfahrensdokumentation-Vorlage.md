# Verfahrensdokumentation (GoBD) — Vorlage für ReWaWi-Betreiber

> **Hinweis:** Diese Vorlage beschreibt die technischen Verfahrensweisen von ReWaWi.
> Fülle die mit `[...]` markierten Stellen mit deinen betriebsspezifischen Angaben,
> unterschreibe und bewahre das Dokument revisionsfest auf (z. B. als PDF).
> Die Verfahrensdokumentation obliegt dem Betreiber; diese Vorlage ersetzt keine
> steuerliche Beratung.

**Betreiber:** `[Firma, Inhaber, Anschrift]`
**Zeitraum:** gültig ab `[Datum]`, Version der Software: `[z. B. ReWaWi v1.0.0]`
**Erstellt am:** `[Datum]` · **Unterschrift:** `__________________`

---

## 1. Zweck und Geltungsbereich

Diese Verfahrensdokumentation beschreibt, wie mit der Software **ReWaWi**
(Rechnungs- & Warenwirtschaft, Teil der PraxiOS-Familie) steuerlich relevante
Belege (Ausgangsrechnungen, Gutschriften, Eingangsrechnungen, Angebote,
Bestellungen, Lieferscheine, Zahlungseingänge) erfasst, verarbeitet, gespeichert
und aufbewahrt werden — gemäß den Grundsätzen zur ordnungsmäßigen Führung und
Aufbewahrung von Büchern, Aufzeichnungen und Unterlagen in elektronischer Form
sowie zum Datenzugriff (GoBD).

## 2. Systembeschreibung

- **Software:** ReWaWi `[Version]`, selbst gehostet (Open Source, AGPL-3.0)
- **Quelltext/Protokoll:** `[Link zum verwendeten Repo-Stand, z. B. GitHub-Tag v1.0.0]`
- **Betriebsumgebung:** `[z. B. Ubuntu-Server in eigener Praxis, Docker-Container]`
- **Datenbank:** MySQL 8 (utf8mb4), Schema-Versionierung per Self-Migration beim Programmstart
- **Zugriff:** HTTPS über `[Domain, z. B. eigene dynv6-Domain]`, ausschließlich nach Anmeldung

## 3. Belegarten und Nummernkreise

| Belegart | Nummernkreis | Vergabe |
|---|---|---|
| Ausgangsrechnungen | `[Präfix, z. B. RE-]` + fortlaufende Nummer | lückenlos, automatisch bei Finalisierung |
| Gutschriften | eigener Nummernkreis `[Präfix]` | lückenlos, automatisch |
| Angebote, Bestellungen, Lieferscheine | eigene Nummernkreise | automatisch bei Erstellung |

Entwürfe erhalten **keine** endgültige Nummer; die Nummer wird erst bei der
Finalisierung aus dem lückenlosen Nummernkreis vergeben. Eine nachträgliche
Änderung finalisierter Belege ist technisch nicht möglich (siehe Abschnitt 5).

## 4. Erfassung und Verarbeitung

- **Ausgangsrechnungen:** manuell, aus Angeboten (Umwandlung), aus
  Serien-Rechnungen (wiederkehrende Vorlagen) oder aus Altbestand-Import (CSV,
  mit Originalnummern und Import-Kennzeichnung).
- **Eingangsrechnungen:** manuell oder per E-Rechnung-Empfang (XRechnung-XML
  und ZUGFeRD-PDF). Das Original-XML wird validiert und unverändert archiviert.
- **Zahlungseingänge:** manuell oder per Kontoauszug-Import (Bank-CSV/SumUp)
  mit automatischem Matching auf offene Rechnungen; Teilzahlungen werden
  saldiert geführt.
- **E-Mail-Versand:** Belege können per SMTP versendet werden; jeder Versand
  wird mit Zeitpunkt und Empfänger protokolliert (Versandprotokoll).

## 5. Unveränderbarkeit und Storno

- Finalisierte Rechnungen und Gutschriften sind in der Software **nicht mehr
  bearbeitbar** und können nicht gelöscht werden.
- Korrekturen erfolgen ausschließlich durch **Storno** (mit eigenem Vermerk und
  Bezug auf den Originalbeleg) bzw. durch **Gutschrift** im eigenen
  Nummernkreis mit Verrechnung zur Originalrechnung.
- Jeder Vorgang ist mit Zeitstempel und Benutzerkonto nachvollziehbar.

## 6. Benutzer und Berechtigungen

- Zugang nur mit persönlichem Benutzerkonto; Passwörter werden ausschließlich
  als scrypt-Hash gespeichert.
- Rollen: **Admin** (voller Zugriff inkl. Benutzerverwaltung und Einstellungen)
  und **Benutzer** (fachlicher Zugriff ohne Verwaltung).
- Verantwortlich für die Benutzerverwaltung: `[Name]`.

## 7. Speicherung, Sicherung und Aufbewahrung

- **Speicherort:** `[Server-Standort, z. B. Praxisräume, Adresse]`
- **Backup:** `[z. B. täglicher mysqldump per Cronjob, Aufbewahrung 14 Tage,
  zusätzlich wöchentlich extern auf ...]`
- **Aufbewahrungsfristen:** steuerlich relevante Belege 10 Jahre
  (§ 147 AO), Handelsbriefe 6 Jahre; Löschung erst nach Fristablauf gemäß
  Löschkonzept (`docs/datenschutz/Loeschkonzept.md`).
- **Unveränderbarkeit der Archivierung:** Backups werden unverändert
  aufbewahrt; Wiederherstellungen werden dokumentiert.

## 8. Updates und Migration

- Updates erfolgen über die Git-Versionsverwaltung; jede Version ist als
  Release/Tag nachvollziehbar.
- Das Datenbank-Schema aktualisiert sich beim Programmstart selbst
  (Self-Migration); vor jedem Update wird ein Datenbank-Backup erstellt
  (`update.sh` dokumentiert den Ablauf).

## 9. Datenschutz

Verzeichnis der Verarbeitungstätigkeiten, technische und organisatorische
Maßnahmen sowie Löschkonzept liegen als separate Dokumente vor:
`docs/datenschutz/VVT-Vorlage.md`, `docs/datenschutz/TOM-Dokument.md`,
`docs/datenschutz/Loeschkonzept.md`.

## 10. Änderungshistorie dieses Dokuments

| Datum | Version Software | Änderung | Name |
|---|---|---|---|
| `[Datum]` | `[Version]` | Ersterstellung | `[Name]` |
