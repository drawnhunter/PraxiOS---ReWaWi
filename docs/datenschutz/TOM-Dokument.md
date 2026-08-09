# Technische und organisatorische Maßnahmen (TOM) — Vorlage

> Stand: ____________ · Verantwortlicher: ______________________________________________

| Bereich | Maßnahme |
|---|---|
| Zutrittskontrolle | Server in verschlossenem Raum/Aufenthaltsbereich; physische Zugänge dokumentiert |
| Zugangskontrolle (System) | Login mit Benutzername + Passwort (scrypt-Hash); Rollen Admin/Benutzer; Sessions mit Ablaufdatum; HTTPS (TLS-Zertifikat, Let's Encrypt) |
| Zugriffskontrolle (Daten) | Keine öffentlichen Endpunkte außer Login/Setup; Fach-API nur authentifiziert; `LOCAL_AUTH_BYPASS` niemals produktiv |
| Übertragungskontrolle | Verschlüsselte Übertragung (TLS); SMTP-Versand dokumentiert im Versandprotokoll; Hinweis: keine Gesundheitsdaten unverschlüsselt per E-Mail an Patienten |
| Verfügbarkeitskontrolle | Nächtliche DB-Sicherung (Cronjob), zusätzlich Kopie auf separates Gerät; Wiederherstellungstest mindestens jährlich |
| Software-Pflege | Regelmäßige Updates (update.sh / Docker-Rebuild); Selbst-Migration kontrolliert Schemaänderungen |
| Geheimnisse | APP_SECRET zufällig; SMTP-Passwort AES-256-verschlüsselt in DB; keine Geheimnisse im Code/Git |
| Löschkontrolle | Löschung personenbezogener Daten manuell und protokolliert (siehe Loeschkonzept.md) |
| Mitarbeiter | Zugriffe nur für angewiesene Personen; Verpflichtung auf Vertraulichkeit |
