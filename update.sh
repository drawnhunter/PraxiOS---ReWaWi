#!/usr/bin/env bash
# WAWIPROS aktualisieren: neuesten Stand von GitHub ziehen und neu bauen.
# Einrichtung (einmalig):  git clone https://github.com/DEIN-NAME/wawipros.git
# Danach genuegt:          ./update.sh
set -e
cd "$(dirname "$0")"
echo "==> Lade neueste Version von GitHub ..."
git pull --ff-only
echo "==> Baue und starte Container neu ..."
docker compose up -d --build
echo "==> Fertig! Bitte im Browser hart neu laden (Strg+F5)."
echo "    (Datenbank-Schema wird beim Start automatisch migriert.)"
