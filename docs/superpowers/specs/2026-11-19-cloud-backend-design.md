# 雲端後端設計文件（Phase 1）

**日期**：2026-11-19
**狀態**：已實作並合併到 main（2026-11-19）。實作與本規格的差異記錄在 `docs/architecture.md`。
**前置文件**：`docs/superpowers/specs/2026-11-19-ios-feasibility-assessment.md`

---

## 目標

把 RemindMe 從「單機 Tauri + 本機 NestJS sidecar + SQLite」改成「雲端 NestJS + PostgreSQL + 帳號系統」，桌面版改為登入後直接打雲端 API。這是後續 iOS 版的地基。

## 已定案的決策

| 項目 | 決策 |
|------|------|
| 雲端主機 | Oracle Cloud Always Free ARM VM（Ubuntu aarch64），Docker Compose 部署 |
| HTTPS | Caddy 反向代理 + Let's Encrypt，網域先用 DuckDNS 免費子網域 |
| 資料庫 | PostgreSQL 16，跟後端同一台 VM、同一個 Docker Compose，不對外開放 |
| 認證 | 自建 Email + 密碼，JWT access token + 不輪替的 refresh token |
| 桌面本機模式 | **不保留**。桌面版一律登入，資料全部在雲端；移除 sidecar 與內附 node.exe。（之後改為「不登入可用本機模式」，見 `2026-11-19-local-mode-design.md`；sidecar 仍不放回，本機模式改用 Rust 實作） |
| 開發隔離 | 每個 agent 各自一個 git worktree / 分支 |

## 不在本階段範圍

忘記密碼 email、Apple/Google 登入、iOS App、APNs 推播、`Device` 資料表、離線同步、舊 SQLite 資料匯入工具、多台後端水平擴展。

---

## 分工與檔案所有權

三個 agent 平行開發。**只能修改自己負責的路徑**；需要動到別人的路徑時，在最終回報裡寫清楚，由主 session 統一協調。

| Agent | 分支 | 負責路徑 |
|-------|------|---------|
| `backend` | `feat/cloud-backend` | `backend/src/**`、`backend/prisma/**`、`backend/package.json`、`backend/package-lock.json`、`backend/test/**` |
| `client` | `feat/cloud-client` | `frontend/**`、`src-tauri/**`、`.github/workflows/release.yml` |
| `infra` | `feat/cloud-infra` | `deploy/**`（新建）、`docker-compose.yml`、`.env.example`、`backend/.env.example`、`backend/Dockerfile`、`backend/entrypoint.sh`、`frontend/Dockerfile` |
| 主 session | `main` | `docs/**`、`README.md`、合併 |

各 agent 的任務說明在 `docs/superpowers/plans/2026-11-19-cloud-{backend,client,infra}.md`。

---

## 資料模型（Prisma，`provider = "postgresql"`）

舊的 SQLite migration（`backend/prisma/migrations/*`）整個刪掉，重新產生一份 PostgreSQL 的 `init` migration。雲端沒有既有資料，不需要遷移。

```prisma
model User {
  id             String          @id @default(uuid())
  email          String          @unique            // 一律存小寫、trim 後的值
  passwordHash   String
  timezone       String          @default("Asia/Taipei") // IANA 時區名稱
  createdAt      DateTime        @default(now())
  updatedAt      DateTime        @updatedAt
  reminders      Reminder[]
  groups         Group[]
  displaySetting DisplaySetting?
  refreshTokens  RefreshToken[]
}

model RefreshToken {
  id         String    @id @default(uuid())
  userId     String
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash  String    @unique   // sha256(refreshToken) 的 hex，原始 token 不落地
  expiresAt  DateTime
  revokedAt  DateTime?
  createdAt  DateTime  @default(now())
  @@index([userId])
}
```

既有 model 的變更：

- `Reminder`：加 `userId String` + relation（`onDelete: Cascade`）+ `@@index([userId])`
- `Group`：加 `userId`（Cascade）；`name @unique` 改為 `@@unique([userId, name])`（群組名稱在同一個使用者底下才算重複）
- `DisplaySetting`：加 `userId String @unique`（Cascade），從「全域單例」改成「每人一份」，Get-or-Create 以 `userId` 為鍵
- `RecurrenceRule.weekDays`：從 JSON 字串改回原生 `Int[] @default([])`，移除 `reminders.service.ts` 與 `scheduler.service.ts` 裡的 serialize/parse 輔助函式
- `MascotImage`：不變

---

## API 契約

Base URL：開發時 `http://localhost:3000`，正式環境 `https://<DOMAIN>`。除了標示「公開」的端點外，**所有端點都需要** `Authorization: Bearer <accessToken>`，缺少或無效時回 `401`。

### 認證（/auth）

| 方法 | 路徑 | 公開 | Request body | 成功回應 |
|------|------|------|--------------|---------|
| POST | /auth/register | ✅ | `{ email, password, timezone? }` | `201 { accessToken, refreshToken, user }` |
| POST | /auth/login | ✅ | `{ email, password }` | `200 { accessToken, refreshToken, user }` |
| POST | /auth/refresh | ✅ | `{ refreshToken }` | `200 { accessToken }` |
| POST | /auth/logout | ✅ | `{ refreshToken }` | `204`（撤銷該 refresh token；token 不存在也回 204）|
| GET | /auth/me | — | — | `200 user` |
| PATCH | /auth/me | — | `{ timezone }` | `200 user` |

- `user` 的形狀固定為 `{ id, email, timezone }`，絕不回傳 `passwordHash`。
- `email`：class-validator `IsEmail`，存之前轉小寫並 trim。`password`：8–72 字元（bcrypt 上限 72 bytes）。`timezone`：必須是合法的 IANA 名稱（用 `Intl.supportedValuesOf('timeZone')` 或 `new Intl.DateTimeFormat('en', { timeZone })` 驗證），register 沒帶時用預設值 `Asia/Taipei`。
- 錯誤代碼沿用專案既有的 409 + code 慣例（參考 `SHORT_MONTH_CONFIRMATION_REQUIRED` 的丟法）：
  - 註冊時 email 已存在 → `409`，code `EMAIL_TAKEN`
  - 登入帳密錯誤 → `401`，code `INVALID_CREDENTIALS`（不區分「帳號不存在」或「密碼錯誤」）
  - refresh token 無效、過期或已撤銷 → `401`，code `INVALID_REFRESH_TOKEN`
- Access token：JWT HS256，payload `{ sub: userId }`，有效期 `JWT_ACCESS_TTL`（預設 `15m`）。
- Refresh token：`crypto.randomBytes(48).toString('base64url')` 產生的不透明字串，資料庫只存 sha256 雜湊，有效期 `REFRESH_TOKEN_TTL_DAYS`（預設 30）。**不輪替**：`/auth/refresh` 只發新的 access token，refresh token 本身到期或登出前都有效。這樣多個視窗（主視窗、彈窗）同時 refresh 時不會互相把對方踢下線。
- 密碼雜湊：`bcryptjs`（純 JS，避免 ARM Docker 映像檔編譯 native 模組的問題），cost 12。
- 速率限制：`@nestjs/throttler`，`/auth/register`、`/auth/login`、`/auth/refresh` 每個 IP 每分鐘 10 次。

### 既有端點

`/reminders/**`、`/groups/**`、`/display-settings/current`、`/scheduler/due` 的**路徑與 request/response 形狀都不變**，只多了兩件事：

1. 需要登入，所有查詢與寫入都限定在 `req.user.id` 的資料範圍內。
2. 存取別人的資源（例如 `GET /reminders/<別人的 id>`）一律回 `404`（不回 403，避免洩漏資源是否存在）。`POST /reminders/reorder` 帶入不屬於自己的 id 時回 `404`。建立/更新提醒時帶的 `groupId` 不屬於自己也回 `404`。

### 公開端點

`GET /health`（維持 `{ status: 'ok' }`）、`GET /docs`（Swagger，加上 Bearer auth 設定）。

---

## 排程引擎（SchedulerService）改造

現有實作是單人單機設計，搬上雲端有三個問題必須修：

### 1. 時區（最重要）

雲端主機跑在 UTC。現有 `isRuleDue()` 用 `now.getHours()` / `now.getDay()` / `now.getDate()` 取「伺服器本地時間」，上雲後每天 09:00 的提醒會在台灣時間 17:00 才跳出來。

改成用**使用者的 `timezone`** 計算牆上時間（時、分、星期、日期），建議用 `Intl.DateTimeFormat(..., { timeZone, hourCycle: 'h23', ... }).formatToParts()`，不需要額外加套件。`oneTimeAt` 本身是絕對時間（UTC instant），比較方式不變。`getWindowKey()` 也要改用使用者時區的日期與時間。

**必須有單元測試**：在 `TZ=UTC` 的環境下，時區 `Asia/Taipei` 的使用者設定每日 `09:00`，要在 `01:00Z` 觸發、`09:00Z` 不觸發；weekly_day 與 monthly_day 在 UTC 跟台灣跨日的邊界（台灣週一 07:00 = UTC 週日 23:00）也要測。

### 2. 多使用者、多裝置的佇列

現有的 `pendingQueue` 是全域的，誰先呼叫 `/scheduler/due` 誰就把整個佇列拿走——多使用者時 A 會拿到 B 的提醒。

改成：

- `GET /scheduler/due` 需要登入，加上必填 header `X-Device-Id`（client 產生的 UUID，缺少時回 `400`）。
- Service 維護 `lastSeen: Map<"userId:deviceId", timestamp>` 與 `queues: Map<"userId:deviceId", DueReminderDto[]>`。
- 提醒觸發時，推進該使用者**最近 2 分鐘內有輪詢過**的每個裝置的佇列。沒有任何裝置在線 → 這次觸發就沒人收到（行為跟現在「桌面 App 沒開就不會跳提醒」一致）。
- `/scheduler/due` 只回傳並清空「該使用者、該裝置」的佇列。
- `DueReminderDto` 形狀不變；`corner` / `size` / `targetScreenId` 取自**該使用者**的 DisplaySetting。

### 3. 狀態與規模的已知限制（本階段接受）

- `firedSet`、`snoozeUntilMap`、佇列都在記憶體裡，後端重啟會遺失延後狀態——接受。`fireCount` 已經持久化，不受影響。
- 只能跑**單一後端實例**（記憶體狀態不共享）。
- 每 3 秒掃描所有啟用中的提醒，要 `include` user 的 timezone 與 displaySetting，**一次查完**，避免每個提醒各查一次（N+1）。
- `resetReminder` / `clearFiredSet` 等既有輔助函式，在 reminders service 呼叫時要確認仍然是作用在自己的提醒上。

---

## 後端環境變數

| 變數 | 說明 | 預設值 |
|------|------|--------|
| `DATABASE_URL` | PostgreSQL 連線字串 | （必填）|
| `JWT_ACCESS_SECRET` | access token 簽章密鑰，至少 32 字元 | （必填，啟動時缺少就直接 crash）|
| `JWT_ACCESS_TTL` | access token 有效期 | `15m` |
| `REFRESH_TOKEN_TTL_DAYS` | refresh token 有效天數 | `30` |
| `CORS_ORIGINS` | 允許的 Origin，逗號分隔 | `http://localhost:3001,http://tauri.localhost,tauri://localhost` |
| `PORT` | 監聽埠 | `3000` |

CORS 用 allowlist（不再 `enableCors()` 全開）。token 放在 header 不用 cookie，所以不需要 `credentials: true`。

開發用 `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/remindme?schema=public`，用 `docker compose up -d db` 起本機資料庫。

---

## Client 端行為（桌面版）

- API base URL 改成**建置時**決定：前端讀 `NEXT_PUBLIC_API_BASE_URL`，Rust 讀編譯時環境變數 `REMINDME_API_BASE_URL`（`option_env!`），兩者預設都是 `http://localhost:3000`，release build 時兩個都設成同一個雲端網址。
- Token 與裝置 ID 存在 webview 的 `localStorage`（key：`remindme.auth`、`remindme.deviceId`）。主視窗和彈窗是同一個 origin，所以會共用。
- `apiFetch()` 自動帶上 `Authorization` 與 `X-Device-Id`；收到 401 時先呼叫 `/auth/refresh` 一次（同一個視窗內 single-flight），重試失敗就清掉 token、導向 `/login`。
- Rust 輪詢器（`scheduler.rs`）需要 token 才能打 `/scheduler/due`：新增 Tauri command `set_session { accessToken, deviceId }` 與 `clear_session`。前端在登入、啟動、每次 refresh 後都呼叫 `set_session`；沒有 session 時 Rust 跳過輪詢。Rust 收到 401 時 emit `session-expired` 事件給主視窗，主視窗 refresh 後再呼叫一次 `set_session`。主視窗每 10 分鐘主動 refresh 一次。
- 移除 `sidecar.rs`、`get_api_base_url`、dev 模式等待 `/health` 的迴圈、`tauri.conf.json` 的 `bundle.resources`（node.exe 與 backend bundle）、release workflow 中下載 Node 與建置後端的步驟。
- 保留 tray、single-instance、autostart、彈窗相關的所有功能。

---

## 合併順序

1. `feat/cloud-infra`（只動部署檔，不影響執行中的程式）
2. `feat/cloud-backend`
3. `feat/cloud-client`（依賴 backend 的 API）

每個分支合併前由主 session 檢查 diff，跑 backend `npm test`、`npm run build`，以及 frontend `npm run build`。**合併到 `main` 與 push 都要先經過使用者同意。**
