#!/usr/bin/env bash
echo "=== CONTAINER ==="; sudo docker ps --format "{{.Names}}  {{.Status}}"
echo "=== APP-LOG (letzte 15) ==="; sudo docker compose -f ~/wawipros/docker-compose.yml logs --tail 15 app
echo "=== DB-LOG (letzte 5) ==="; sudo docker compose -f ~/wawipros/docker-compose.yml logs --tail 5 db
echo "=== PLATZ ==="; df -h / | tail -1
echo "=== SPEICHER ==="; free -h | head -2
echo "=== DATEIEN ==="; ls ~/wawipros | head -30
