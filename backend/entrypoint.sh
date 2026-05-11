#!/bin/sh
# 容器啟動時自動把 prisma schema 推到 DB；schema 沒變動會直接 "already in sync"
# 不影響既有資料（用 db push 不會 reset）

set -e

echo "[entrypoint] Pushing prisma schema to DB..."
npx prisma db push --skip-generate

echo "[entrypoint] Schema in sync, starting app..."
exec "$@"
