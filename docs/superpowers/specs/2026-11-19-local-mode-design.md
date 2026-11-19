# 桌面版本機模式設計（不登入也能用）

- 狀態：設計完成，等 macos-dev / ci / mobile-web 三個分支合併後開工
- 取代：`2026-11-19-cloud-backend-design.md` 裡「桌面版一律登入、不保留本機模式」這一條決定，其餘雲端設計不變

## 使用者決定

| 項目 | 決定 |
|------|------|
| 不登入能不能用 | 可以。桌面版預設進入本機模式，提醒存在這台電腦 |
| 登入後的資料 | 只用雲端資料，**不合併、不上傳、不同步**本機資料 |
| 登入時本機資料 | **保留**。登入期間本機提醒不顯示、不排程；登出後回到原本的本機提醒 |
| 舊版（sidecar + SQLite）資料 | 第一次啟動時自動匯入本機模式 |
| 手機瀏覽器版 | 不受影響，瀏覽器一律要登入（沒有本機模式） |

## 模式

App 任何時刻只有一種模式，由 Rust 的 `SessionState` 決定：

- **本機模式**：沒有 session。資料讀寫本機 SQLite，排程由 Rust 本機排程器負責。
- **雲端模式**：有 session。行為跟現在完全一樣（打雲端 API、Rust 輪詢 `/scheduler/due`）。

模式切換：

| 事件 | 結果 |
|------|------|
| 啟動，沒有存好的 refresh token | 本機模式，直接進主畫面（不再強制導向 `/login`） |
| 啟動，有 refresh token 且 refresh 成功 | 雲端模式 |
| 啟動，refresh 失敗（過期 / 被撤銷） | 本機模式 + 提示「登入已過期，目前顯示本機提醒」並提供「重新登入」 |
| 在主畫面點「登入」→ 登入 / 註冊成功 | 雲端模式。登入前提示一次：「登入後會顯示雲端帳號的提醒；這台電腦上的 N 則本機提醒會保留，登出後回來」 |
| 登出 | 本機模式 |
| 雲端模式中 refresh 失敗（`session-expired`） | 同「啟動時 refresh 失敗」 |
| 雲端模式但網路斷線 / 後端掛了 | 維持雲端模式，顯示錯誤（不自動退回本機，避免使用者以為資料不見） |

所有視窗（主視窗、popup、popup-manager）都要跟著同一個模式；切換時 Rust 發 `mode-changed` 事件（payload：`"local" | "cloud"`），各視窗重新載入資料。

## 架構：在 Rust 裡實作同一份 API 合約

前端所有 API 呼叫都經過 `frontend/src/lib/apiBase.ts` 的 `apiFetch(path, init)`（目前約 13 處呼叫，路徑見下表）。本機模式下，`apiFetch` 不發 HTTP，改成：

```ts
invoke('local_api', { method, path, body }) // 回傳 { status: number, body: unknown }
```

再包成一個 `Response` 物件回給呼叫端，**頁面與元件完全不用知道現在是哪個模式**。

Rust 端 `local_api` 是一個小型路由器，實作跟雲端後端相同的請求 / 回應格式（JSON 欄位名、狀態碼、錯誤格式 `{ statusCode, message, code? }` 都一樣）：

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/reminders` | 依 sortOrder 排序，含 recurrenceRules、group |
| GET | `/reminders/:id` | |
| POST | `/reminders` | 驗證規則同後端 DTO |
| PATCH | `/reminders/:id` | |
| DELETE | `/reminders/:id` | |
| PATCH | `/reminders/:id/enable`、`/disable` | |
| POST | `/reminders/reorder` | |
| PATCH | `/reminders/:id/snooze` | |
| GET / POST | `/groups` | |
| PATCH / DELETE | `/groups/:id` | |
| GET / PATCH | `/display-settings/current` | |

`/auth/*` 不在本機路由內（登入相關一律打雲端）；本機模式收到未知路徑回 404。

**合約一致性是這個設計的核心**：DTO 驗證規則、預設值、錯誤碼以 `backend/src/**/dto` 與 `docs/architecture.md` 的 API 章節為準。Rust 端要有對應的測試，可以直接參考 `backend/src/**/*.spec.ts` 的案例改寫。

### 本機儲存

- 檔案：`{app_data_dir}/local.db`（SQLite，`rusqlite` + `bundled` feature）
- 資料表跟雲端 schema 相同，但**沒有** `User`、`RefreshToken`，也沒有 `userId` 欄位；`weekDays` 用 JSON 字串存（SQLite 沒有陣列）
- 用 `PRAGMA user_version` 做 schema 版本，啟動時跑內建 migration
- 單一 `Mutex<Connection>` 放在 Tauri state；所有視窗的 `local_api` 共用

### 本機排程器

- 把 `backend/src/scheduler/scheduler.service.ts` 的判斷邏輯移植到 Rust（每隔 N 分鐘含時段與星期、每天、每週、每月、一次性、延後、`endAt`、`maxOccurrences` / `fireCount`）
- 時區：直接用作業系統的本地時間（`chrono::Local`），不需要帳號時區
- 每 3 秒檢查一次；觸發視窗 30 秒；延後狀態可以存 DB（本機不怕重啟遺失，比雲端版好）
- 觸發後直接呼叫現有的開彈窗流程（跟雲端輪詢器拿到 due 清單後走同一條路）
- 只在本機模式執行；雲端模式時暫停（雲端輪詢器只在雲端模式執行）
- `scheduler.service.spec.ts` 的案例要移植成 Rust 測試，兩邊結果必須一致

### 舊版資料匯入

- 舊版 sidecar 的資料在 `{app_data_dir}/remindme.db`（Prisma + SQLite，schema 見 commit `ebee72d0` 之前的 `backend/prisma/schema.prisma`）
- 啟動時：`local.db` 不存在且 `remindme.db` 存在 → 讀取 Group、Reminder、RecurrenceRule、DisplaySetting 匯入 `local.db`，成功後把舊檔改名成 `remindme.db.imported`（不刪除）
- Prisma 在 SQLite 存 DateTime 與 enum 的實際格式要先用真的舊檔確認；匯入失敗只記 log，不阻擋啟動
- 舊版 schema 有 `MascotImage`，新版有沒有對應欄位以目前 `backend/prisma/schema.prisma` 為準，沒有就略過

## 前端變更

- `auth.ts`：沒有 session 不再導向 `/login`；提供 `getMode()` 與模式切換事件
- `apiBase.ts`：`apiFetch` 依模式分流（雲端 → HTTP 加 token；本機 → `invoke('local_api')`）
- 主畫面：右上角顯示目前模式（「本機」或帳號 email），本機模式有「登入以使用雲端同步」按鈕；登入前的確認對話框
- `/login`：多一個「先不登入，使用本機模式」的返回按鈕
- 瀏覽器（非 Tauri）：維持一律登入，沒有本機模式

## 測試

- Rust：本機路由器（每個端點的成功與錯誤案例）、排程器（移植 `scheduler.service.spec.ts`）、舊版匯入（用測試建立的舊 schema SQLite 檔）
- 前端：`apiFetch` 分流、模式切換、登入確認對話框
- 手動：本機建提醒 → 到期彈窗 → 登入看到雲端資料、本機提醒不觸發 → 登出回到本機提醒；舊版資料升級後出現

## 影響範圍

- `src-tauri/`：新增 `local_store.rs`（DB + migration + 匯入）、`local_api.rs`（路由器）、`local_scheduler.rs`；`lib.rs`、`session.rs`、`scheduler.rs` 調整模式切換
- `frontend/src/lib/`：`apiBase.ts`、`auth.ts`；`app/page.tsx`、`app/login/`
- 文件：`README.md`、`docs/architecture.md`、`docs/superpowers/specs/2026-11-19-cloud-backend-design.md`（標註被本文件取代的段落）
- `backend/`、`deploy/`：不需要改

## 已知取捨

- 排程邏輯與 API 驗證在 TypeScript 與 Rust 各一份，之後改規則要兩邊一起改（靠兩邊對照的測試守住）
- 本機模式的資料只在這台電腦，不會出現在手機或其他電腦
