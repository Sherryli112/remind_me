# syntax=docker/dockerfile:1
#
# RemindMe 後端正式環境映像檔（multi-stage）
# - 基底用 Debian bookworm-slim（不用 alpine，避免 Prisma 引擎的 musl / openssl 相容問題）
# - 可直接在 arm64（Oracle Cloud ARM VM、Apple Silicon）與 amd64 上 build
# - 容器啟動時先跑 `prisma migrate deploy` 再啟動 `node dist/main`

ARG NODE_IMAGE=node:20-bookworm-slim

# ---------- build stage：安裝完整依賴、產生 Prisma client、編譯 TypeScript ----------
FROM ${NODE_IMAGE} AS build

# Prisma 會用 openssl 判斷要下載哪一版查詢引擎（slim 映像檔預設沒有）
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npx prisma generate \
  && npm run build

# ---------- runtime stage：只帶 production 依賴、dist、prisma、產生好的 client ----------
FROM ${NODE_IMAGE} AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
  PORT=3000 \
  NPM_CONFIG_UPDATE_NOTIFIER=false \
  CHECKPOINT_DISABLE=1

WORKDIR /app

# production 依賴
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
  && npm cache clean --force

# prisma CLI 是 devDependency，但容器啟動時要跑 `prisma migrate deploy`。
# 這裡從 package-lock.json 讀出鎖定的版本，另外全域安裝「同一版」CLI，
# 而不是保留整包 dev 依賴（jest、nest cli、typescript…），讓映像檔小很多。
RUN PRISMA_VERSION="$(node -p "require('./package-lock.json').packages['node_modules/prisma'].version")" \
  && echo "Installing prisma CLI ${PRISMA_VERSION}" \
  && npm install -g "prisma@${PRISMA_VERSION}" \
  && npm cache clean --force

# 產生好的 Prisma client（預設輸出在 node_modules/.prisma/client）、編譯結果、schema 與 migrations
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma

# 以非 root 使用者執行（node 映像檔內建 uid 1000 的 node 使用者）。
# /app 維持 root 擁有、node 使用者唯讀，程式本身不需要寫入 /app。
USER node

EXPOSE 3000

CMD ["sh", "-c", "prisma migrate deploy && exec node dist/main"]
