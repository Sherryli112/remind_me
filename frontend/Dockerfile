# syntax=docker/dockerfile:1
#
# RemindMe 網頁版 + 反向代理映像檔（multi-stage）
# - build stage：用 Node 建置 Next.js 靜態匯出（frontend/out）
# - runtime stage：以 caddy:2 為基底，把靜態檔放到 /srv，由 deploy/Caddyfile 提供網頁並轉發 API
# - node:20-bookworm-slim 與 caddy:2 都是 multi-arch，可直接在 arm64（Oracle Cloud ARM VM）上 build
# - 主機上不需要安裝 Node
#
# 用法（通常由 deploy/docker-compose.prod.yml 帶入）：
#   docker build --build-arg NEXT_PUBLIC_API_BASE_URL=https://remindme-xxx.duckdns.org -t remindme-web frontend

ARG NODE_IMAGE=node:20-bookworm-slim
ARG CADDY_IMAGE=caddy:2

# ---------- build stage ----------
FROM ${NODE_IMAGE} AS build

ENV NEXT_TELEMETRY_DISABLED=1 \
  NPM_CONFIG_UPDATE_NOTIFIER=false \
  NPM_CONFIG_FUND=false \
  NPM_CONFIG_AUDIT=false

WORKDIR /app

# 先只複製依賴清單，原始碼改動時才不用重新 npm ci
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# API 位址在「建置時」寫死進 JS（NEXT_PUBLIC_*）。網頁版跟 API 同網域，填 https://<DOMAIN>
ARG NEXT_PUBLIC_API_BASE_URL
RUN if [ -z "$NEXT_PUBLIC_API_BASE_URL" ]; then \
      echo "必須用 --build-arg NEXT_PUBLIC_API_BASE_URL=https://<DOMAIN> 建置" >&2; exit 1; \
    fi \
  && echo "NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}" \
  && NEXT_PUBLIC_API_BASE_URL="$NEXT_PUBLIC_API_BASE_URL" npm run build

# ---------- runtime stage ----------
FROM ${CADDY_IMAGE}

# Caddyfile 由 docker-compose 以 volume 掛進 /etc/caddy/Caddyfile（改設定不用重新 build）
COPY --from=build /app/out /srv
