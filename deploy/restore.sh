#!/usr/bin/env bash
# Yedekten geri yükleme: ./restore.sh backups/apivator-20261021-030000.dump
# Mevcut veritabanının yerine geçer. Önce o anki hâlin yedeği alınır (backups/before-restore-*.dump).
set -euo pipefail
cd "$(dirname "$0")"

dump="${1:-}"
if [[ -z "$dump" || ! -f "$dump" ]]; then
  echo "Kullanım: ./restore.sh backups/apivator-....dump" >&2
  ls -1t backups/*.dump 2>/dev/null | head -5 | sed 's/^/  /' >&2 || true
  exit 2
fi

read -r -p "\"$dump\" geri yüklenecek; mevcut veriler bu yedekle DEĞİŞTİRİLECEK. Devam? (evet/hayır) " answer
[[ "$answer" == "evet" ]] || { echo "Vazgeçildi."; exit 1; }

safety="backups/before-restore-$(date +%Y%m%d-%H%M%S).dump"
docker compose exec -T postgres pg_dump -U apivator -d apivator -Fc --no-owner --no-acl > "$safety"
echo "Mevcut hâlin yedeği: $safety"

# Uygulama dururken geri yüklenir; açık bağlantı ve yarım yazma olmaz.
docker compose stop api web
docker compose exec -T postgres psql -U apivator -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS apivator WITH (FORCE);" -c "CREATE DATABASE apivator OWNER apivator;"
docker compose exec -T postgres pg_restore -U apivator -d apivator --no-owner --no-acl --exit-on-error < "$dump"
docker compose start api web
echo "Geri yüklendi. API açılırken eksik migration'lar varsa kendiliğinden uygulanır."
