#!/usr/bin/env bash
# 管理員重設密碼（在 VM 上執行）：使用者忘記密碼時，由管理員設定新密碼。
#
#   ./deploy/reset-password.sh user@example.com
#
# 會要求輸入兩次新密碼（畫面不顯示）。新密碼經由 stdin 傳進 backend 容器，
# 不會出現在指令參數、ps 或 shell 歷史裡。
# 成功後這個帳號在所有裝置都會被登出（桌面版會回到本機模式並提示重新登入），
# 請把新密碼用安全的方式告訴使用者，並請對方登入後到帳號選單「修改密碼」換成自己的密碼。
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

COMPOSE_FILE="deploy/docker-compose.prod.yml"
ENV_FILE="deploy/.env"

if [[ $# -ne 1 || -z "$1" ]]; then
  echo "用法：./deploy/reset-password.sh <email>" >&2
  exit 1
fi
email="$1"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "找不到 ${ENV_FILE}，請在 repo 根目錄（~/remind_me）執行。" >&2
  exit 1
fi

read -r -s -p "新密碼（8–72 個字元）：" password
echo
read -r -s -p "再輸入一次：" password_confirm
echo

if [[ "$password" != "$password_confirm" ]]; then
  echo "兩次輸入的密碼不一樣，沒有做任何變更。" >&2
  exit 1
fi

printf '%s\n' "$password" |
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" \
    exec -T backend node dist/cli/reset-password.js "$email"
