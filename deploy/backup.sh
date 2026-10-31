#!/usr/bin/env bash
# Elle yedek: ./backup.sh  →  deploy/backups/apivator-YYYYMMDD-HHMMSS.dump
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p backups
file="backups/apivator-$(date +%Y%m%d-%H%M%S).dump"
docker compose exec -T postgres pg_dump -U apivator -d apivator -Fc --no-owner --no-acl > "$file.part"
mv "$file.part" "$file"
echo "Yedek alındı: $file ($(du -h "$file" | cut -f1))"
