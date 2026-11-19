# 任務：雲端後端（agent `backend`，分支 `feat/cloud-backend`）

先完整讀過 `/Users/work/Desktop/RemindMe/docs/superpowers/specs/2026-11-19-cloud-backend-design.md`，那是規格的唯一依據；本文件只列出你的工作範圍與驗收標準。規格有衝突或寫不清楚的地方，用最合理的方式處理，並在最終回報裡寫出來，不要停下來等。

## 只能修改的路徑

`backend/src/**`、`backend/prisma/**`、`backend/package.json`、`backend/package-lock.json`、`backend/test/**`。
**不要**動 `backend/.env.example`、`backend/Dockerfile`、`docker-compose.yml`（屬於 infra agent），也不要動 `frontend/`、`src-tauri/`。你自己用的 `backend/.env` 不會被 commit（已在 .gitignore），可以自由修改。

## 本機資料庫

```bash
docker run -d --name remindme-pg-dev -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=remindme -p 5432:5432 postgres:16
```

`backend/.env`：

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/remindme?schema=public
JWT_ACCESS_SECRET=dev-secret-dev-secret-dev-secret-0000
```

注意 `package.json` 的 `prisma:*` script 讀的是 `../.env`（repo 根目錄）。可以直接用 `npx prisma ...`（會讀 `backend/.env`），或把 script 改成讀 `backend/.env`。選一種並在回報裡說明。

## 工作項目

1. **Prisma 改用 PostgreSQL**：`provider = "postgresql"`，刪除 `prisma/migrations/` 底下舊的 SQLite migration 與 `migration_lock.toml`，依規格加上 `User`、`RefreshToken`、各 model 的 `userId`，`weekDays` 改為 `Int[]`，然後 `npx prisma migrate dev --name init` 產生新的 migration。
2. **移除 weekDays 的 JSON 轉換**：`reminders.service.ts` 的 `serializeWeekDays` / `deserializeWeekDays` / `normalizeRule` / `normalizeReminder`，以及 `scheduler.service.ts` 的 `JSON.parse`。API 回傳的形狀（`weekDays: number[]`）要維持不變。
3. **AuthModule**（`src/auth/`）：register / login / refresh / logout / me（GET、PATCH），規格裡的錯誤代碼、bcryptjs、throttler 都要做到。
4. **全域 JWT guard**：預設所有路由都需要登入，`@Public()` decorator 標記公開端點（`/health`、`/auth/register`、`/auth/login`、`/auth/refresh`、`/auth/logout`）。用 `@nestjs/jwt` + 自寫 guard，或 `@nestjs/passport` 都可以。提供 `@CurrentUser()` decorator 取得 `{ id }`。
5. **多租戶**：`RemindersService`、`GroupsService`、`DisplaySettingsService` 每個方法都加上 `userId` 參數，所有查詢與寫入都限定在該使用者範圍內；存取別人的資源一律回 404（包含 reorder 帶入的 id、create/update 帶入的 `groupId`）。
6. **SchedulerService 改造**：時區、per-user/per-device 佇列、`X-Device-Id` header，依規格「排程引擎改造」一節。既有的 `scheduler.service.spec.ts` 要改到通過，並補上時區邊界測試。
7. **main.ts**：CORS 改為 `CORS_ORIGINS` allowlist；啟動時檢查 `JWT_ACCESS_SECRET` 存在且至少 32 字元，否則直接丟錯結束；Swagger 加上 `addBearerAuth()`。`RUNTIME_PORT=` 這行 log 可以保留。

## 驗收

- `npm run build` 通過、`npm test` 全部通過。
- 新增測試至少涵蓋：時區計算（規格列出的邊界案例）、多裝置佇列（同一個使用者兩台裝置都收到、別的使用者收不到、超過 2 分鐘沒輪詢的裝置收不到）、AuthService 的 register/login/refresh 主要路徑與錯誤代碼。
- 實際啟動後端，用 curl 跑一次完整流程並把指令與結果貼在最終回報：註冊 → 用 access token 建立提醒 → 列出提醒 → 用第二個帳號列出提醒（應為空）→ 第二個帳號 GET 第一個帳號的提醒（應為 404）→ refresh → logout 之後 refresh（應為 401）。

## 收尾

- 在 `feat/cloud-backend` 分支上 commit（可以分多個 commit），commit message 用繁體中文，結尾加上：
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- **不要 push、不要合併到 main。**
- 最終回報寫成 Markdown 存到 `/tmp/remindme-handoff/backend.md`（先 `mkdir -p`），內容包含：做了什麼、規格偏離之處與理由、驗收結果、需要其他 agent 或主 session 配合的事項。
- 做完後停止，主 session 會讀取這份回報。
