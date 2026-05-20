# Tauri 桌面殼層設計文件

**日期**：2026-05-20  
**狀態**：已核准

---

## 目標

將 RemindMe 從純 Web 應用包裝成 Windows 桌面應用程式（`.exe`）。使用者點擊圖示即可啟動，提醒到期時自動在螢幕角落彈出無框視窗。

---

## 架構概覽

### 生產模式

```
Tauri.exe
  ├─ spawn → node backend/dist/main.js   (NestJS :3000 + SQLite)
  ├─ 等待健康檢查通過
  ├─ WebView 主視窗 → http://localhost:3000
  ├─ [Rust timer 每 30 秒] → GET :3000/scheduler/due
  │       ↓ [{id, title, corner, size, ...}]
  └─ create_window("popup-{id}") → http://localhost:3000/popup/{id}
```

### 開發模式

```
Terminal A: cd backend && npm run start:dev   (NestJS :3000)
Terminal B: cd frontend && npm run dev        (Next.js :3001)
Terminal C: cd src-tauri && cargo tauri dev   (WebView → :3001)
```

---

## 子系統一：資料庫遷移（PostgreSQL → SQLite）

### 變更範圍

| 檔案 | 變更 |
|------|------|
| `backend/prisma/schema.prisma` | `provider = "sqlite"` |
| `backend/.env` | `DATABASE_URL = "file:./data/remindme.db"` |
| `backend/.env.example` | 同上 |
| `backend/package.json` | 移除 `pg` 依賴 |
| `docker-compose.yml` | 移除 `db` service，保留 backend/frontend service（開發用） |

### SQLite 資料庫位置

- **開發**：`backend/data/remindme.db`（.gitignore 排除）
- **生產**：由 Tauri 的 `app_data_dir()` 決定（Windows：`%APPDATA%\remindme\remindme.db`），透過環境變數 `DATABASE_URL` 傳入 NestJS sidecar

### 不相容性確認

現有 schema 未使用 PostgreSQL 專屬功能（`uuid_generate_v4()` 除外）。Prisma 在 SQLite 下自動使用 `cuid()` 或 `uuid()`，`@default(uuid())` 完全相容。`Int[]`（RecurrenceRule.weekDays）在 SQLite 下 Prisma 以 JSON 儲存，行為一致。

### 遷移步驟

```bash
cd backend
npm uninstall pg
# 修改 schema.prisma 和 .env
npx prisma migrate dev --name sqlite-migration
```

---

## 子系統二：NestJS Scheduler

### 新增模組

```
backend/src/scheduler/
  ├─ scheduler.module.ts
  ├─ scheduler.service.ts    # 觸發邏輯 + in-memory 防重複
  └─ scheduler.controller.ts # GET /scheduler/due
```

### 觸發邏輯

`SchedulerService` 使用 `@Cron(CronExpression.EVERY_30_SECONDS)`：

```
每 30 秒執行：
  1. 取得所有 enabled=true 的提醒（含 RecurrenceRule）
  2. 對每條提醒呼叫 isDue(reminder, now) → boolean
  3. 過濾出 isDue=true 且不在 firedSet 中的提醒
  4. 加入 firedSet（key = "{id}-{windowKey}"）
  5. 存入 pendingQueue
```

`GET /scheduler/due` 回傳並清空 `pendingQueue`（消費式讀取，Tauri 取走即清除）。

### isDue 計算規則

| RuleMode | 觸發條件 |
|----------|----------|
| `one_time` | `oneTimeAt` 在 `[now-30s, now]` 區間內 |
| `daily_time` | 今天的 `timeOfDay` 在 `[now-30s, now]` 區間內 |
| `weekly_day` | 今天是 `weekDays` 之一，且 `timeOfDay` 在區間內 |
| `monthly_day` | 今天是 `monthDay`，且 `timeOfDay` 在區間內（短月份跳過） |
| `interval` | `now % intervalMinutes == 0`（±15 秒容差），在 `activeFrom~activeUntil` 時段內，且今天是 `weekDays` 之一（若有設定） |

### 防重複機制

```typescript
// key 格式："{reminderId}-{YYYY-MM-DD-HH-MM}"（精確到分鐘）
// in-memory Set，重啟清空（可接受）
private firedSet = new Set<string>();
```

`endAt` 和 `maxOccurrences` 的截止判斷也在此處執行：
- `endAt`：若 `now > endAt`，跳過
- `maxOccurrences`：需要一個 `fireCount` Map，達上限後停止觸發（重啟歸零，可接受 MVP）

### API 回應格式

```typescript
// GET /scheduler/due
[
  {
    id: string;
    title: string;
    content: string;
    autoCloseEnabled: boolean;
    autoCloseSeconds: number;
    snoozeDefaultSeconds: number;
    corner: PopupCorner;  // 從 DisplaySetting 取得
    size: PopupSize;
  }
]
```

---

## 子系統三：Popup 路由（Next.js）

### 新增頁面

`frontend/src/app/popup/[id]/page.tsx`

### 功能

- 呼叫 `GET /reminders/{id}` 取得提醒資料
- 呼叫 `GET /display-settings/current` 取得尺寸/主題設定
- 顯示：吉祥物圖示、標題、內容（若 showContent=true）
- **延後按鈕**：呼叫 `PATCH /reminders/{id}/snooze`（新增 API），更新下次觸發時間，然後呼叫 `window.__TAURI__.window.getCurrentWindow().close()`
- **關閉按鈕**：直接關閉視窗
- `autoCloseEnabled` 時顯示倒數進度條，時間到自動關閉

### Tauri 視窗設定（popup）

```json
{
  "decorations": false,
  "alwaysOnTop": true,
  "skipTaskbar": true,
  "transparent": true,
  "width": 320,
  "height": 160,
  "resizable": false
}
```

位置依 `DisplaySetting.corner` 動態計算（螢幕寬高 - 視窗尺寸 - 邊距）。

### Snooze API

```
PATCH /reminders/:id/snooze
Body: { seconds: number }
```

對 `one_time` 提醒：將 `oneTimeAt` 設為 `now + seconds`  
對 `recurring` 提醒：在 SchedulerService 的 `snoozeUntil` Map 中記錄 `{id: now + seconds}`，輪詢時若 `now < snoozeUntil[id]` 則跳過觸發

---

## 子系統四：Tauri Shell

### 目錄結構

```
src-tauri/
  ├─ Cargo.toml
  ├─ tauri.conf.json
  ├─ build.rs
  └─ src/
      ├─ main.rs         # 入口、視窗建立
      ├─ sidecar.rs      # NestJS 子程序管理
      ├─ scheduler.rs    # 30 秒輪詢 + 開 popup
      ├─ popup.rs        # 計算視窗位置、建立視窗
      └─ tray.rs         # 系統匣圖示與選單
```

### 啟動流程

```
1. App 啟動
2. sidecar::spawn_nestjs(db_path, port=3000)
3. 輪詢 GET :3000/health 最多 30 秒（每 1 秒）
4. 健康後：建立主視窗（WebView → :3000）
5. 建立系統匣圖示
6. 啟動 scheduler::start_polling()
```

### NestJS Sidecar

Tauri 使用 `tauri-plugin-shell` 的 `sidecar` 功能。NestJS 先用 `nest build` 編譯成 `dist/`，再用 `pkg` 或直接依賴系統 Node.js。

**MVP 方案**：依賴系統已安裝的 Node.js，spawn `node backend/dist/main.js`。  
**未來**：用 `pkg` 打包成獨立執行檔作為 Tauri sidecar。

### 系統匣

- 圖示：`icons/icon.png`（32×32）
- 選單：「顯示主視窗」、「退出」
- 關閉主視窗時隱藏（不退出），點匣圖示顯示
- 退出時先 kill NestJS 子程序

### tauri.conf.json 關鍵設定

```json
{
  "app": {
    "windows": [{
      "label": "main",
      "url": "http://localhost:3000",
      "width": 1200,
      "height": 800,
      "decorations": true,
      "visible": false
    }]
  },
  "bundle": {
    "identifier": "com.funtime.remindme",
    "icon": ["icons/icon.png"]
  }
}
```

---

## 實作順序

```
Phase 1：SQLite 遷移（最小破壞性，可獨立驗證）
Phase 2：NestJS Scheduler + /scheduler/due 端點
Phase 3：Next.js /popup/[id] 頁面
Phase 4：Tauri Shell（sidecar + 主視窗 + 匣）
Phase 5：Tauri 輪詢 + Popup 視窗整合
```

---

## 不在範圍內（本次）

- 吉祥物自訂圖片上傳
- 暗色模式完整主題
- 多螢幕支援
- macOS / Linux 支援
- NestJS sidecar 打包為獨立執行檔（pkg）
- maxOccurrences 重啟後持久化

---

## 技術依賴

| 套件 | 用途 |
|------|------|
| `@nestjs/schedule` | NestJS cron 排程 |
| `tauri` (2.x) | 桌面殼層 |
| `tauri-plugin-shell` | spawn sidecar |
| `tauri-plugin-tray` | 系統匣 |
| `@tauri-apps/api` | 前端呼叫 Tauri API |
