# RemindMe

RemindMe MVP 專案骨架，包含：
- `frontend`：Next.js 管理介面
- `backend`：NestJS API（含 Swagger + Prisma）
- `docker-compose.yml`：本地整合啟動（frontend/backend/postgres）

## 快速啟動

1. 複製環境檔：
   - `cp .env.example .env`
2. 啟動容器：
   - `docker compose up --build`
3. 開啟服務：
   - 前端：`http://localhost:3001`
   - 後端：`http://localhost:3000`
   - Swagger：`http://localhost:3000/docs`

### Prisma 指令（backend）

- 產生 client：`npm run prisma:generate`
- 同步 schema 到資料庫：`npm run prisma:push`
- 建立 migration：`npm run prisma:migrate`
- 以上指令會自動讀取根目錄 `.env`（`../.env`）

## 目前進度

- 已完成基礎資料模型（提醒、重複規則、顯示設定、吉祥物圖片）
- 已接入 PostgreSQL（Prisma）
- 已完成提醒 CRUD、啟用停用、排序 API
- 已完成顯示設定讀取與更新 API
- 已完成前端 MVP 基礎操作頁（建立/列出/啟停/刪除提醒）
