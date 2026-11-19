#!/usr/bin/env bash
# 列出所有帳號（在 VM 上執行，只讀）：
#
#   ./deploy/list-users.sh
#
# 欄位：email、時區、註冊時間（台灣時間）、提醒數、登入中的裝置數（未撤銷且未過期的 refresh token）。
# 資料庫只存密碼雜湊，查不到原本的密碼；忘記密碼請用 ./deploy/reset-password.sh。
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

COMPOSE_FILE="deploy/docker-compose.prod.yml"
ENV_FILE="deploy/.env"

docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" \
  exec -T db psql -U remindme -d remindme -c '
SELECT
  u.email,
  u.timezone,
  to_char(u."createdAt" AT TIME ZONE '"'"'UTC'"'"' AT TIME ZONE '"'"'Asia/Taipei'"'"', '"'"'YYYY-MM-DD HH24:MI'"'"') AS "註冊時間（台灣）",
  (SELECT COUNT(*) FROM "Reminder" r WHERE r."userId" = u.id) AS "提醒數",
  (SELECT COUNT(*) FROM "RefreshToken" t
     WHERE t."userId" = u.id AND t."revokedAt" IS NULL AND t."expiresAt" > now()) AS "登入中裝置"
FROM "User" u
ORDER BY u."createdAt";'
