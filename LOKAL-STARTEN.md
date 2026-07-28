# WAWIPROS — lokal auf dem eigenen PC starten

So testest du das Programm auf deinem Rechner. Beim ersten Start erwartet dich
die **Ersteinrichtung**: Admin-Konto anlegen → Firmendaten (und optional
Bankverbindung) eintragen → fertig. Kunden und Produkte kannst du danach
per CSV importieren (Listen → „CSV importieren").

---

## Weg A: Docker (empfohlen — ein Befehl)

**Voraussetzung:** [Docker Desktop](https://www.docker.com/products/docker-desktop/)
(Windows / Mac) bzw. Docker Engine (Linux).

1. Diesen Ordner herunterladen/entpacken.
2. Terminal **in diesem Ordner** öffnen.
3. Starten:

   ```
   docker compose up --build
   ```

   Beim ersten Mal dauert es ein paar Minuten (Images werden geladen).
4. Browser öffnen: **http://localhost:3000** → Ersteinrichtung durchlaufen.

**Beenden:** `Strg + C` (oder `docker compose down`). Deine Daten bleiben im
Docker-Volume `db-daten` erhalten.

**Komplett neu anfangen** (lokale Datenbank löschen):

```
docker compose down -v
docker compose up --build
```

> Port 3000 muss frei sein. Falls belegt: in `docker-compose.yml` unter
> `ports:` die **erste** Zahl ändern, z. B. `"3100:3000"` → http://localhost:3100.

**Vorhandene Datensicherung statt leerer Datenbank?** Die Sicherung als
`dump.sql` in diesen Ordner legen und in `docker-compose.yml` die markierte
Zeile einkommentieren (siehe Kommentar dort).

---

## Weg B: Ohne Docker (Node.js + MySQL direkt)

**Voraussetzungen:** Node.js 20+ (https://nodejs.org) und MySQL 8
(https://dev.mysql.com/downloads/mysql/, oder MariaDB 10.6+).

1. **Datenbank anlegen und Schema importieren:**

   ```
   mysql -u root -p -e "CREATE DATABASE wawipros CHARACTER SET utf8mb4;"
   mysql -u root -p wawipros < schema.sql
   ```

2. **`.env` anlegen:** `.env.example` nach `.env` kopieren und
   `DATABASE_URL` sowie `APP_SECRET` setzen
   (Zufallssecret z. B. mit `openssl rand -hex 32`).

3. **Installieren, bauen, starten:**

   ```
   npm install
   npm run build
   ```

   - Mac / Linux: `npm start`
   - Windows (Eingabeaufforderung): `set NODE_ENV=production && node dist\boot.js`
   - Windows (PowerShell): `$env:NODE_ENV="production"; node dist\boot.js`

4. Browser öffnen: **http://localhost:3000** → Ersteinrichtung.

---

## Wichtig zu wissen

- **`LOCAL_AUTH_BYPASS=1`** überspringt den Login (jeder ist automatisch
  Admin). Nur für reine Funktionstests auf dem eigenen Rechner —
  **niemals** auf einem erreichbaren Server setzen!
- Lokal erzeugte Daten bleiben lokal; es gibt keine Cloud-Synchronisation.
