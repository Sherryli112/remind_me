#!/usr/bin/env bash
# RemindMe 部署 / 更新腳本（在 VM 上執行，可以重複執行）
#
#   ./deploy/deploy.sh
#
# 流程：git pull → 重新 build 映像檔（後端 + 網頁版前端/Caddy）→ 啟動容器 → 等後端 /health 回應
#       → 從外部確認 API 與網頁版 → 印出結果。
# 設定 SKIP_PULL=1 可略過 git pull（例如想部署目前工作目錄的內容）。
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

COMPOSE_FILE="deploy/docker-compose.prod.yml"
ENV_FILE="deploy/.env"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-180}"
# 從外部檢查 HTTPS 的等待時間：第一次部署時 Caddy 要先向 Let's Encrypt 申請憑證，通常需要幾十秒
EXTERNAL_TIMEOUT="${EXTERNAL_TIMEOUT:-120}"

compose() {
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
}

log() { printf '\n==> %s\n' "$*"; }

if [[ ! -f "$ENV_FILE" ]]; then
  echo "找不到 ${ENV_FILE}。請先執行：cp deploy/.env.example deploy/.env，並填好裡面的值。" >&2
  exit 1
fi

if [[ "${SKIP_PULL:-0}" != "1" ]]; then
  log "git pull"
  git pull --ff-only
fi

# 每次都重新 build：網頁版前端是在 build 時打包進 caddy 映像檔的（API 位址也是 build 時寫進去），
# 沒有重新 build 就不會拿到新的前端。沒改到的部分會用 Docker 快取，很快就結束。
log "build 映像檔：後端 + 網頁版前端（第一次在 ARM VM 上 build 可能要好幾分鐘）"
compose build

log "啟動容器"
compose up -d --remove-orphans

log "等待後端 /health（最多 ${HEALTH_TIMEOUT} 秒）"
deadline=$((SECONDS + HEALTH_TIMEOUT))
until compose exec -T backend node -e \
  "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
  >/dev/null 2>&1; do
  if (( SECONDS >= deadline )); then
    echo "後端在 ${HEALTH_TIMEOUT} 秒內沒有回應 /health。最近的 log：" >&2
    compose logs --tail=80 backend >&2 || true
    exit 1
  fi
  printf '.'
  sleep 3
done
echo " 後端 OK"

# 清掉 build 留下、已經沒用到的舊映像檔，避免 VM 磁碟被吃滿
docker image prune -f >/dev/null || true

log "容器狀態"
compose ps

DOMAIN="$(grep -E '^DOMAIN=' "$ENV_FILE" | tail -n1 | cut -d= -f2- | tr -d "\"' \r")"
if [[ -n "$DOMAIN" ]]; then
  log "從外部確認 https://${DOMAIN}/health（最多等 ${EXTERNAL_TIMEOUT} 秒，第一次部署要等憑證申請完成）"
  external_ok=0
  deadline=$((SECONDS + EXTERNAL_TIMEOUT))
  while true; do
    if curl -fsS --max-time 15 "https://${DOMAIN}/health" 2>/dev/null; then
      external_ok=1
      break
    fi
    (( SECONDS >= deadline )) && break
    printf '.'
    sleep 5
  done
  if (( external_ok )); then
    echo
    log "從外部確認網頁版 https://${DOMAIN}/"
    if curl -fsS --max-time 15 "https://${DOMAIN}/" | grep -qi '<html'; then
      echo "網頁版 OK"
    else
      echo "API 正常，但 https://${DOMAIN}/ 沒有回傳網頁。請看：docker compose -f $COMPOSE_FILE logs caddy" >&2
      exit 3
    fi
    echo "部署完成：https://${DOMAIN}（手機用瀏覽器打開這個網址即可登入管理提醒）"
  else
    echo
    echo "後端在 VM 內部正常，但等了 ${EXTERNAL_TIMEOUT} 秒仍從 https://${DOMAIN} 連不到。" >&2
    echo "可能是憑證還沒申請好、DuckDNS 沒指到這台主機，或 80/443 防火牆沒開。稍後再試：curl https://${DOMAIN}/health" >&2
    echo "仍失敗請看：docker compose -f $COMPOSE_FILE logs caddy，並參考 deploy/README.md 的常見問題。" >&2
    exit 2
  fi
fi
