# Sicherheitsrichtlinie / Security Policy

## Meldung von Sicherheitslücken

Bitte melde Sicherheitslücken **nicht** öffentlich als Issue, sondern per E-Mail an:

**drawn.hunter@proton.me**

Wir bestätigen den Eingang innerhalb von 7 Tagen (best effort) und melden uns
mit einer Einschätzung zurück. Bitte keine aktive Ausnutzung der Lücke und
keine Veröffentlichung vor einem Fix (verantwortungsvolle Offenlegung).

## Unterstützte Versionen

| Version | Status |
|---|---|
| 1.0.x | ✅ wird mit Sicherheitsfixes versorgt |

## Hinweise für Betreiber

- `LOCAL_AUTH_BYPASS` **niemals** auf einem erreichbaren Server setzen (deaktiviert die Anmeldung komplett).
- `APP_SECRET` zufällig und geheim halten; bei Verdacht auf Kompromittierung rotieren (alle Sessions werden ungültig).
- SMTP-Passwörter werden AES-256-verschlüsselt in der Datenbank abgelegt (Schlüssel = `APP_SECRET`).
- Server und Container regelmäßig aktualisieren; Backups verschlüsselt aufbewahren.
