#!/bin/sh
# backup container'ında çalışır: her gün BACKUP_HOUR'da tam yedek alır, BACKUP_KEEP_DAYS günden eskileri siler.
# Elle yedek için: ./backup.sh
set -eu
mkdir -p /backups

backup() {
  file="/backups/apivator-$(date +%Y%m%d-%H%M%S).dump"
  # -Fc: sıkıştırılmış özel biçim; pg_restore ile tamamı ya da seçilen tablolar geri yüklenebilir.
  if pg_dump -Fc --no-owner --no-acl -f "$file.part"; then
    mv "$file.part" "$file"
    echo "$(date -Iseconds) yedek alındı: $(basename "$file") ($(du -h "$file" | cut -f1))"
  else
    rm -f "$file.part"
    echo "$(date -Iseconds) HATA: yedek alınamadı" >&2
  fi
  find /backups -name 'apivator-*.dump' -mtime +"$BACKUP_KEEP_DAYS" -print -delete
}

echo "Yedekleme: her gün saat ${BACKUP_HOUR}:00, ${BACKUP_KEEP_DAYS} gün saklanır (/backups)."
last=""
while true; do
  today=$(date +%Y-%m-%d)
  hour=$(date +%H | sed 's/^0//')
  if [ "${hour:-0}" -eq "$BACKUP_HOUR" ] && [ "$last" != "$today" ]; then
    backup
    last=$today
  fi
  sleep 300
done
