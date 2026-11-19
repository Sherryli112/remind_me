#!/usr/bin/env bash
# RemindMe 資料庫備份（在 VM 上執行）
#
#   ./deploy/backup.sh
#
# 用 pg_dump 備份到 ~/remindme-backups/remindme-YYYYmmdd-HHMMSS.sql.gz，只保留最近 KEEP 份（預設 14）。
# 還原方式見 deploy/README.md 的「備份與還原」。
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

COMPOSE_FILE="deploy/docker-compose.prod.yml"
ENV_FILE="deploy/.env"
BACKUP_DIR="${BACKUP_DIR:-$HOME/remindme-backups}"
KEEP="${KEEP:-14}"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

timestamp="$(date +%Y%m%d-%H%M%S)"
target="$BACKUP_DIR/remindme-${timestamp}.sql.gz"
tmp="${target}.partial"

# 失敗時不要留下不完整的檔案
trap 'rm -f "$tmp"' EXIT

# --clean --if-exists：還原時會先 DROP 既有物件，直接覆蓋即可
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T db \
  pg_dump -U remindme -d remindme --clean --if-exists --no-owner \
  | gzip -9 > "$tmp"

# 基本檢查：壓縮檔完整且不是空的
gzip -t "$tmp"
if [[ "$(gzip -dc "$tmp" | head -c 1 | wc -c)" -eq 0 ]]; then
  echo "備份內容是空的，可能 pg_dump 失敗" >&2
  exit 1
fi

mv "$tmp" "$target"
chmod 600 "$target"
echo "$(date '+%F %T') 備份完成：${target}（$(du -h "$target" | cut -f1)）"

# 只保留最近 KEEP 份（檔名含時間戳，字典序即時間順序）
removed=0
while IFS= read -r f; do
  rm -f -- "$f"
  removed=$((removed + 1))
done < <(find "$BACKUP_DIR" -maxdepth 1 -name 'remindme-*.sql.gz' -type f | sort -r | tail -n "+$((KEEP + 1))")
if (( removed > 0 )); then
  echo "已刪除 ${removed} 份舊備份"
fi
