# RemindMe 架構文件

## 概覽

RemindMe 是雲端同步的桌面提醒管理工具。桌面端是 Tauri 2 殼層（Windows、macOS），載入 Next.js 靜態輸出的管理介面；資料與排程都在雲端的 NestJS 後端（PostgreSQL），使用者登入帳號後使用。同一個帳號可以在多台電腦登入，也可以用手機瀏覽器開同一個網址管理提醒（網頁版不跳通知，彈窗只在桌面 App）。未來的 iOS 版也會接同一組 API。

同一份前端靜態輸出有兩種執行環境：Tauri webview（桌面 App）與一般瀏覽器（網頁版，由 Caddy 在同一個網域提供）。

```
┌──────────── 桌面（每台電腦一份）────────────┐          ┌──────── 雲端 VM（Oracle Cloud ARM）────────┐
│  Tauri 2（Rust）                              │          │  Docker Compose                              │
│                                               │  HTTPS   │                                              │
│  主視窗（main）：Next.js 靜態輸出              │ ───────▶ │  Caddy :443（自動 HTTPS）                    │
│    登入 → token 存 localStorage               │          │    │ reverse_proxy                           │
│    apiFetch 自動帶 Bearer + X-Device-Id       │          │    ▼                                         │
│    set_session ──▶ session.rs                 │          │  NestJS backend :3000（不對外）              │
│                                               │          │    ├─ AuthModule（JWT）                      │
│  scheduler.rs 每 3 秒 GET /scheduler/due ─────┼────────▶ │    ├─ Reminders / Groups / DisplaySettings   │
│    → popup_manager.rs 開彈窗視窗              │          │    └─ SchedulerService（@Cron 每 3 秒）      │
│                                               │          │    │                                         │
│  tray.rs 常駐列、單一實例、開機自動啟動        │          │    ▼                                         │
└───────────────────────────────────────────────┘          │  PostgreSQL 16（volume，不對外）             │
                                                           └──────────────────────────────────────────────┘
```

---

## 技術棧

### 桌面殼層

| 項目 | 版本 / 說明 |
|------|------------|
| 框架 | Tauri 2.11.2（Rust） |
| 常駐列 | `tauri::tray` |
| 單一實例 | `tauri-plugin-single-instance`（避免重複開啟兩個常駐列圖示與兩組輪詢） |
| 開機自動啟動 | `tauri-plugin-autostart` |
| HTTP client | `reqwest`（blocking + `native-tls`，Windows 用 Schannel、macOS 用 Security.framework） |

### 前端

| 項目 | 版本 / 說明 |
|------|------------|
| 框架 | Next.js 16（App Router）+ React 19，`output: export` 靜態輸出 |
| UI 庫 | Mantine v9 + @mantine/dates + @mantine/modals |
| 拖曳排序 | @dnd-kit/core + @dnd-kit/sortable |
| 圖標 | lucide-react |
| Tauri API | @tauri-apps/api |
| 語言 | TypeScript 5 |

### 後端

| 項目 | 版本 / 說明 |
|------|------------|
| 框架 | NestJS 11 |
| ORM | Prisma 6（`prisma-client-js`） |
| 資料庫 | PostgreSQL 16 |
| 認證 | `@nestjs/jwt` 11 + 自寫全域 guard，密碼用 `bcryptjs`（cost 12） |
| 速率限制 | `@nestjs/throttler`（登入、註冊、refresh 每 IP 每分鐘 10 次），`trust proxy = 1` |
| 排程 | `@nestjs/schedule`（`@Cron` 每 3 秒） |
| 驗證 | class-validator + class-transformer |
| API 文檔 | Swagger（`/docs`，Bearer auth） |
| 測試 | Jest 30，強制 `TZ=UTC` 執行 |

### 部署

| 項目 | 說明 |
|------|------|
| 主機 | Oracle Cloud Always Free ARM（aarch64）VM，Ubuntu |
| 容器 | Docker Compose：`db`（postgres:16）、`backend`（node:20-bookworm-slim，非 root）、`caddy`（`remindme-web` 映像檔：`frontend/Dockerfile` 先建置前端，再以 caddy:2 為基底放進 `/srv`） |
| HTTPS | Caddy + Let's Encrypt，網域用 DuckDNS |
| 路由（同網域） | `deploy/Caddyfile` 的 `@api` matcher（`/auth`、`/reminders`、`/groups`、`/display-settings`、`/scheduler`、`/health`、`/docs*`）→ `backend:3000`；其他路徑 → 前端靜態檔（`try_files`）。網頁版與 API 同源，不需要 CORS。**後端新增 `@Controller` 時要同步更新 `@api` 清單** |
| 快取 | `/_next/static/*` 一年 immutable，其他回應 `no-cache` |
| CI | `.github/workflows/ci.yml`：push 到 main 與 PR 時跑後端（lint、單元、e2e + postgres service、build）、前端（lint、測試、build）、Windows `cargo check`。後端 lint 目前 `continue-on-error`（既有錯誤未修） |
| 備份 | `deploy/backup.sh`（`pg_dump`，保留 14 份，crontab 每日執行） |

---

## 目錄結構

```
RemindMe/
├── frontend/
│   ├── src/app/
│   │   ├── page.tsx            # 主頁面（清單 + 編輯器），未登入導向 /login
│   │   ├── login/              # 登入 / 註冊
│   │   ├── popup/              # 單一提醒彈窗頁面
│   │   └── popup-manager/      # 多彈窗協調頁面（height.ts 需與 Rust 端保持一致）
│   ├── src/components/         # TaskForm、DisplayPanel、SortableReminderRow…
│   └── src/lib/
│       ├── apiBase.ts          # apiFetch：帶 token、401 自動 refresh、彈窗委託主視窗 refresh
│       └── auth.ts             # token / 裝置 ID 存取、login / register / logout / refresh
│
├── backend/
│   ├── src/
│   │   ├── auth/               # AuthModule、JwtAuthGuard、@Public()、@CurrentUser()
│   │   ├── reminders/          # 提醒 CRUD、排序、延後
│   │   ├── groups/             # 群組
│   │   ├── display-settings/   # 顯示設定（每個使用者一份）
│   │   ├── scheduler/          # 排程引擎 + /scheduler/due
│   │   ├── common/timezone.ts  # 依 IANA 時區取得牆上時間
│   │   ├── app.setup.ts        # CORS、ValidationPipe、trust proxy（main.ts 與測試共用）
│   │   └── prisma/
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── migrations/         # 20261119073927_init（PostgreSQL）
│   └── Dockerfile              # 正式環境 multi-stage，啟動時 prisma migrate deploy
│
├── src-tauri/src/
│   ├── lib.rs                  # 初始化、Tauri commands
│   ├── session.rs              # SessionState、set_session / clear_session
│   ├── scheduler.rs            # 帶 token 輪詢 /scheduler/due
│   ├── popup.rs                # 彈窗位置計算
│   ├── popup_manager.rs        # 彈窗視窗生命週期
│   └── tray.rs                 # 常駐列
│
├── deploy/                     # docker-compose.prod.yml、Caddyfile、.env.example、deploy.sh、backup.sh、README.md
├── docker-compose.yml          # 本機開發用 PostgreSQL
└── .github/workflows/release.yml   # tag 觸發打包 Windows 安裝檔，需 repo variable API_BASE_URL
```

---

## 資料庫 Schema（PostgreSQL）

### 實體關係圖

```
User (1) ──── (*) RefreshToken
User (1) ──── (*) Group (1) ──── (*) Reminder (1) ──── (*) RecurrenceRule
User (1) ──── (*) Reminder
User (1) ──── (0..1) DisplaySetting (1) ──── (*) MascotImage
```

刪除 User 時，其所有資料一併刪除（Cascade）。刪除 Group 時，提醒的 `groupId` 設為 null。

### User

| 欄位 | 型別 | 說明 |
|------|------|------|
| id | UUID | 主鍵 |
| email | String | 唯一，存小寫並 trim |
| passwordHash | String | bcrypt 雜湊 |
| timezone | String | IANA 時區，預設 `Asia/Taipei` |
| createdAt / updatedAt | DateTime | |

### RefreshToken

| 欄位 | 型別 | 說明 |
|------|------|------|
| id | UUID | 主鍵 |
| userId | UUID | 外鍵（Cascade） |
| tokenHash | String | 唯一，sha256(refreshToken)，原始 token 不落地 |
| expiresAt | DateTime | 預設 30 天後 |
| revokedAt | DateTime? | 登出時設定 |

### Group

| 欄位 | 型別 | 說明 |
|------|------|------|
| id | UUID | 主鍵 |
| userId | UUID | 外鍵（Cascade） |
| name | String | `@@unique([userId, name])`：同一使用者底下不可重複 |
| createdAt | DateTime | |

### Reminder

| 欄位 | 型別 | 說明 |
|------|------|------|
| id | UUID | 主鍵 |
| userId | UUID | 外鍵（Cascade），有索引 |
| title / content | String | 標題（必填）、內容 |
| enabled | Boolean | 預設 true |
| scheduleType | ScheduleType | one_time \| recurring |
| oneTimeAt | DateTime? | 單次提醒時間（絕對時間） |
| autoCloseEnabled / autoCloseSeconds | Boolean / Int | 自動關閉，預設 false / 60 |
| snoozeDefaultSeconds | Int | 延後秒數，預設 300 |
| sortOrder | Int | 排序，依該使用者自己的最大值遞增 |
| endAt / maxOccurrences | DateTime? / Int? | 重複結束條件 |
| fireCount | Int | 已觸發次數（持久化） |
| groupId | UUID? | 外鍵（SetNull） |

### RecurrenceRule

| 欄位 | 型別 | 說明 |
|------|------|------|
| ruleMode | RuleMode | interval \| daily_time \| weekly_day \| monthly_day |
| monthDay | Int? | 1–31 |
| weekDays | Int[] | 0=週日 ~ 6=週六，預設 `[]` |
| timeOfDay | String? | HH:mm（使用者時區的牆上時間） |
| intervalMinutes | Int? | 間隔分鐘 |
| activeFrom / activeUntil | String? | interval 模式的時段限制（HH:mm，支援跨午夜） |
| reminderId | UUID | 外鍵（Cascade） |

### DisplaySetting（每個使用者一份）

| 欄位 | 型別 | 預設值 |
|------|------|--------|
| userId | UUID | 唯一，外鍵（Cascade） |
| size | PopupSize | medium |
| theme | PopupTheme | light |
| corner | PopupCorner | bottom_right |
| showContent | Boolean | true |
| targetScreenId | String? | — |
| mascotMode | MascotMode | system |
| mascotIcon | MascotIcon | bell_ring |

### MascotImage

Schema 已定義（`filePath`、`mimeType`、`width`、`height`、`sizeBytes`、`displaySettingId`），上傳 API / UI 尚未實作。

### Enums

```
ScheduleType  : one_time | recurring
RuleMode      : interval | daily_time | weekly_day | monthly_day
PopupSize     : small | medium | large
PopupTheme    : light | dark
PopupCorner   : top_left | top_right | bottom_left | bottom_right
MascotMode    : system | custom
MascotIcon    : bell_ring | sparkles | calendar_clock
```

---

## 後端模塊架構

```
AppModule
├── ConfigModule（全局，envFilePath: ['.env', '../.env']，啟動時驗證 JWT_ACCESS_SECRET）
├── ScheduleModule
├── ThrottlerModule
├── PrismaModule
├── AuthModule          # 全域 JwtAuthGuard（APP_GUARD），@Public() 標記公開端點
├── RemindersModule
├── GroupsModule
├── DisplaySettingsModule
└── SchedulerModule
```

所有 service 方法都帶 `userId`，查詢一律加 `where: { userId }`；存取別人的資源回 404（不回 403，避免洩漏資源是否存在）。

### 排程引擎（SchedulerService）

- 每 3 秒執行一次，只查詢「最近 2 分鐘內有裝置輪詢過」的使用者的啟用中提醒；沒有人在線時不查 DB。一次 `include` 規則、`user.timezone`、`user.displaySetting`，沒有 N+1。
- **時區**：用 `common/timezone.ts`（`Intl.DateTimeFormat` + `formatToParts`）取得使用者時區的時、分、星期、日期來比對規則。`oneTimeAt` 直接比較絕對時間。觸發容許窗口 ±30 秒。
- **多裝置佇列**：裝置透過 `X-Device-Id` header 識別。提醒觸發時推進該使用者所有在線裝置的佇列（`Map<"userId:deviceId", DueReminderDto[]>`）；`GET /scheduler/due` 只回傳並清空自己那台裝置的佇列。
- **離線行為**：裝置要先輪詢過一次才會開始收提醒；離線期間觸發的提醒不會補發，也不計入 `fireCount`。延後（snooze）在離線時到期，會在下次上線輪詢時跳出。
- `firedSet`（防止同一時間窗口重複觸發，5 分鐘後自動清除）、`snoozeUntilMap`、裝置在線紀錄、佇列都在記憶體裡：後端重啟會遺失延後狀態，且**只能跑單一後端實例**。

---

## API 端點

Base URL：開發 `http://localhost:3000`，正式 `https://<DOMAIN>`。除了標示公開的端點外都需要 `Authorization: Bearer <accessToken>`，缺少或無效回 `401 { code: 'UNAUTHORIZED' }`。

### 認證（/auth）

| 方法 | 路徑 | 公開 | 說明 |
|------|------|------|------|
| POST | /auth/register | ✅ | `{ email, password, timezone? }` → `201 { accessToken, refreshToken, user }` |
| POST | /auth/login | ✅ | `{ email, password }` → `200 { accessToken, refreshToken, user }` |
| POST | /auth/refresh | ✅ | `{ refreshToken }` → `200 { accessToken }`（refresh token 不輪替） |
| POST | /auth/logout | ✅ | `{ refreshToken }` → `204` |
| GET | /auth/me | — | `{ id, email, timezone }` |
| PATCH | /auth/me | — | `{ timezone }` → 更新後的 user |

- Access token：JWT HS256，`{ sub: userId }`，預設 15 分鐘。
- Refresh token：48 bytes 隨機字串，DB 只存 sha256，預設 30 天。
- 密碼 8–72 字元且 UTF-8 不超過 72 bytes。

### 提醒（/reminders）

| 方法 | 路徑 | 說明 |
|------|------|------|
| POST | /reminders | 建立提醒 |
| GET | /reminders | 取得自己的所有提醒（按 sortOrder） |
| GET | /reminders/:id | 取得單一提醒 |
| PATCH | /reminders/:id | 更新提醒 |
| DELETE | /reminders/:id | 刪除提醒 |
| PATCH | /reminders/:id/enable | 啟用 |
| PATCH | /reminders/:id/disable | 停用 |
| POST | /reminders/reorder | 批次調整排序 |
| PATCH | /reminders/:id/snooze | 延後（`{ seconds }`） |

### 群組（/groups）

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | /groups | 取得自己的所有群組 |
| POST | /groups | 建立群組 |
| PATCH | /groups/:id | 重命名 |
| DELETE | /groups/:id | 刪除（提醒的 groupId 設為 null） |

### 顯示設定（/display-settings）

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | /display-settings/current | 取得自己的設定（不存在時自動建立預設值） |
| PATCH | /display-settings/current | 更新設定 |

### 排程（/scheduler）

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | /scheduler/due | 需 `X-Device-Id`（`[A-Za-z0-9_-]`，最長 128）；回傳並清空這台裝置的待觸發佇列 |

### 公開端點

`GET /health`（`{ status: 'ok' }`）、`GET /`、`GET /docs`。正式環境的 `/` 是網頁版，後端的 `GET /` 到不了，健康檢查請用 `/health`。

### 錯誤代碼

錯誤 body 格式為 `{ code, message }`。

| 狀態碼 | code | 情境 |
|--------|------|------|
| 400 | `DEVICE_ID_REQUIRED` | `/scheduler/due` 缺少或格式錯誤的 `X-Device-Id` |
| 401 | `UNAUTHORIZED` | 未登入或 access token 失效 |
| 401 | `INVALID_CREDENTIALS` | 登入帳密錯誤（不區分帳號不存在或密碼錯誤） |
| 401 | `INVALID_REFRESH_TOKEN` | refresh token 不存在、過期或已登出 |
| 404 | — | 資源不存在或不屬於自己（含 reorder 的 id、提醒的 groupId） |
| 409 | `EMAIL_TAKEN` | 註冊的 email 已存在 |
| 409 | `SHORT_MONTH_CONFIRMATION_REQUIRED` | monthly_day 為 29–31 時需二次確認 |
| 409 | — | 群組名稱重複 |
| 429 | — | 登入、註冊、refresh 超過速率限制 |

### 環境變數

| 變數 | 說明 | 預設值 |
|------|------|--------|
| `DATABASE_URL` | PostgreSQL 連線字串 | 必填 |
| `JWT_ACCESS_SECRET` | 至少 32 字元，缺少時後端拒絕啟動 | 必填 |
| `JWT_ACCESS_TTL` | access token 有效期 | `15m` |
| `REFRESH_TOKEN_TTL_DAYS` | refresh token 有效天數 | `30` |
| `CORS_ORIGINS` | 允許的 Origin，逗號分隔 | `http://localhost:3001,http://tauri.localhost,tauri://localhost` |
| `PORT` | 監聽埠 | `3000` |

---

## 桌面殼層（src-tauri）

### 啟動流程

```
啟動 → 顯示主視窗 → setup_tray() → 建立 app_data_dir → scheduler::start_polling()
     → 首次啟動寫入 autostart_init 旗標並啟用開機自動啟動（只限 release build；dev 版不自動啟用）
```

API 位址在**編譯時**決定：Rust 讀 `REMINDME_API_BASE_URL`、前端讀 `NEXT_PUBLIC_API_BASE_URL`，兩者預設 `http://localhost:3000`，release 時都設為 repo variable `API_BASE_URL`。

### 登入 session 與輪詢

1. 主視窗登入（或啟動時讀到既有 token）後呼叫 `set_session { accessToken, deviceId }`。
2. `scheduler.rs` 每 3 秒帶 `Authorization` 與 `X-Device-Id` 打 `/scheduler/due`；沒有 session 時跳過。
3. 收到 401 時對主視窗 emit `session-expired`（同一個 token 只發一次）；主視窗 refresh 後再 `set_session`。
4. 主視窗啟動時 refresh 一次，之後每 10 分鐘 refresh；彈窗視窗不自己 refresh，遇到 401 時 emit `session-expired` 請主視窗處理，等待共用 localStorage 出現新 token。
5. 登出時呼叫 `clear_session`：清除 session 與待顯示的彈窗，並 broadcast `session-cleared`。

### 視窗

| label | 內容 | 特性 |
|-------|------|------|
| `main` | 管理介面（`/`、`/login`） | 關閉時隱藏而非結束（常駐列） |
| `popup-manager` | 彈窗（`/popup-manager`） | 無邊框、透明、置頂、不顯示於工作列，位置由 `popup.rs` 依工作列與多螢幕計算 |

### Tauri Commands

| command | 用途 |
|---------|------|
| `set_session` / `clear_session` | 設定 / 清除 Rust 輪詢器使用的登入 session |
| `get_autostart` / `set_autostart` | 開機自動啟動 |
| `get_pending_reminders` | 取得待顯示的提醒（彈窗重新載入時用） |
| `acknowledge_reminder` | 前端處理完一則提醒後從 pending 移除 |
| `resize_popup` / `hide_popup` / `show_popup` | 控制彈窗視窗 |

### 平台特殊處理

- **Windows + 透明視窗 resize**：WebView2 已知問題（tauri-apps/tauri#10318），resize 後微調尺寸強制重繪。
- **Windows 11 DWM 圓角**：用 `DwmSetWindowAttribute` 關閉系統圓角與邊框。
- **Intel 內顯 GPU 合成 bug**：彈窗與主視窗以 `--disable-gpu` 關閉 GPU 合成。
- **彈窗可用區域**：Windows 用 `GetMonitorInfoW` 的 rcWork；其他平台用 `Monitor::work_area()`（macOS 是 `NSScreen.visibleFrame`，扣掉選單列與 Dock）。
- **macOS 透明視窗**：開啟 tauri `macos-private-api` feature 與 `app.macOSPrivateApi: true`（兩者必須一致）。代價是不能上架 Mac App Store，可自行簽章與公證後散佈。
- **macOS Space**：`popup-manager` 設 `visible_on_all_workspaces(true)`，切到別的桌面也看得到提醒（Windows 忽略此設定）。
- **macOS Dock**：點 Dock 圖示（`RunEvent::Reopen`）會叫回被隱藏的主視窗。

---

## 前端架構

### 頁面

```
/login           登入 / 註冊（SegmentedControl 切換），註冊時帶系統時區
/                未登入導向 /login
├── Sidebar      群組導覽、顯示設定、登入 email 與登出
├── List View    SortableReminderRow（@dnd-kit 拖曳）
└── Editor View  TaskForm（4 種重複模式）
/popup-manager   接收 reminders-updated 事件 / get_pending_reminders，多則提醒堆疊
/popup           單一提醒彈窗（Rust 端已沒有入口，保留待評估）
/manifest.webmanifest  PWA 資訊（網頁版「加入主畫面」）
```

### 桌面 App 與網頁版

- `lib/platform.ts` 的 `isTauri()` 判斷執行環境；只有桌面 App 能用的功能（`invoke`、Tauri 事件、彈窗）一律先檢查它。
- 瀏覽器裡：不呼叫 `set_session` / `clear_session`、不監聽 Tauri 事件；顯示設定隱藏「目標螢幕」與「開機自動啟動」；`/popup*` 由 `DesktopOnly` 包住並導回 `/`。
- 寬度 < 768px 走 `MobileShell`（頂部標題列、底部分頁、全螢幕表單），手機上停用拖曳排序。斷點定義在 `MOBILE_MEDIA_QUERY` 與 `globals.css`，兩邊要一致（有測試檢查）。桌面寬度的版面不變。

### 狀態與儲存

- `localStorage`：`remindme.auth`（token 與 user）、`remindme.deviceId`（`crypto.randomUUID()`），主視窗與彈窗同源共用
- `sessionStorage`：表單草稿
- `localStorage`：側邊欄摺疊狀態
- 啟用 / 停用提醒：樂觀更新

### apiFetch 的 401 處理

1. localStorage 的 token 已被別的視窗換新 → 直接用新 token 重試。
2. 主視窗：single-flight 呼叫 `/auth/refresh`，成功就重試；後端明確拒絕（400/401/403）就清 token 並導向 `/login`；網路錯誤、5xx、429 則保留 token。
3. 彈窗：不 refresh、不導頁，委託主視窗處理，最多等 5 秒。

### 視覺設計

iOS 26 玻璃毛霧風格，靛藍主色，亮 / 暗主題，`public/bg/background.jpg` 背景（選填，有漸層 fallback）。

---

## 開發與部署

- **本機開發**：`docker compose up -d db` → backend `npm run start:dev` → frontend `npm run dev` → `npx @tauri-apps/cli@2 dev`。詳見 `README.md`。
- **雲端部署**：`docs/cloud-setup-guide.md`（帳號與主機）、`deploy/README.md`（主機上的部署、更新、備份）。`deploy.sh` 會一起建置網頁版映像檔。
- **桌面版發佈**：推送 `v*` tag，GitHub Actions 打包 Windows 安裝檔。

---

## 已實現功能

- 帳號系統：註冊、登入、登出、JWT 自動 refresh、速率限制
- 多租戶資料隔離、多裝置同時登入
- 依使用者時區計算的排程引擎
- 提醒 CRUD、啟用 / 停用、拖曳排序、延後
- 4 種重複規則，interval 支援時段（含跨午夜）與星期過濾
- 群組分類、短月份二次確認
- 顯示設定（尺寸、主題、位置、目標螢幕、吉祥物圖標）+ 即時預覽
- Tauri 桌面殼層：常駐列、單一實例、開機自動啟動、原生無邊框彈窗
- 雲端部署設定：Docker Compose、Caddy 自動 HTTPS、部署與備份腳本
- 手機網頁版：同網域部署、手機排版、PWA 加入主畫面
- macOS 桌面版：已在 macOS 15（Apple Silicon）實際跑過登入狀態、輪詢、彈窗定位、多則堆疊、跨 Space
- CI：push / PR 自動測試

## 待實現 / 已知限制

- **尚未在真實環境驗證**：Windows 上 native-tls 連 Let's Encrypt 憑證、release workflow 實跑、真的 iPhone / Android 瀏覽器；macOS 上需要點擊的操作（延後、關閉、登入表單、登出、常駐列選單）
- 忘記密碼（需要寄信服務）、Apple / Google 登入
- iOS 版（見 `docs/superpowers/specs/2026-11-19-ios-feasibility-assessment.md`）
- 不登入的本機模式與舊版 SQLite 資料匯入：已設計（`docs/superpowers/specs/2026-11-19-local-mode-design.md`），尚未實作
- 吉祥物自訂圖片上傳
- 排程狀態在記憶體中，後端只能單一實例、重啟會遺失延後狀態；彈窗未處理前重開 App，那則提醒不會再出現
- `targetScreenId` 是每個帳號一份、跨裝置共用，但螢幕名稱因平台而異（macOS 是 `Monitor #<id>`），對不到時退回主螢幕；應改成每台裝置各自設定
- macOS 版尚未打包發佈（release 只出 Windows；需要簽章、公證與單色選單列圖示）
