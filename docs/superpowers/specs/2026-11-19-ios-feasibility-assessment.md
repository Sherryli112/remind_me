# iOS 版可行性評估

**日期**：2026-11-19（初版）／已更新：方向改為「雲端後端優先，iOS 為後續客戶端」
**狀態**：評估中（尚未核准任何實作）

---

## 目標

評估讓 RemindMe 支援 iOS 需要哪些架構變更。初版評估發現兩條路線（延伸 Tauri / 原生 Swift）都卡在「iOS 不能跑本機 sidecar」這個問題上。後確認產品方向是**未來要做雲端化：帳號登入、多裝置同步、用手機新增/修改/刪除提醒**——這個方向本身就會解掉 iOS 最大的技術障礙，因此本文件更新為：先把雲端後端這個地基做好，iOS（以及其他未來的客戶端）在這之上會是相對小的一步。本文件仍**不包含任何程式碼變更**，純粹是現況分析與規劃。

---

## 關鍵結論：雲端化讓 iOS 問題變小

初版評估卡住的點是：桌面版後端（NestJS）靠 Tauri `sidecar.rs` 在本機 spawn 一個 Node.js 子行程才能跑，而 iOS 沙盒禁止任意啟動子行程，所以「要嘛把後端整個用 Rust 重寫,要嘛兩套 codebase 分開維護」。

一旦後端變成**部署在雲端、多人多裝置共用的服務**，這個問題就不存在了：iOS 端（不管是 Tauri Mobile 還是原生 Swift）**不需要本機後端**，只是單純打 HTTPS API——跟現在桌面前端打 `localhost:3000` 本質上是同一件事，只是 base URL 換成雲端網址。桌面版的 `sidecar.rs` 這塊屆時也可以整個拿掉（或保留做離線模式）。

真正的工程重心因此從「怎麼讓 iOS 跑起來」，轉移到「怎麼把現有單機 NestJS + SQLite，改造成支援帳號系統、多使用者、多裝置同步的雲端服務」——這本來就是你要的功能，跟是否做 iOS 無關，應該優先做。

---

## 雲端後端需要的子系統

以現有 `backend/`（NestJS 11 + Prisma）為基礎，推算要補的部分：

### 1. 帳號與認證（全新模組）

- `AuthModule`：註冊、登入、密碼雜湊（bcrypt/argon2）、JWT 發行與驗證（或 session + refresh token）
- 密碼重設流程（忘記密碼 email）
- 可選：第三方登入（Apple/Google Sign-In，iOS 上 Apple 登入幾乎是必選項，App Store 審查對純第三方帳號系統有要求）
- 全局 `AuthGuard` 套用到所有現有 Controller（reminders/groups/display-settings/scheduler）

### 2. 多租戶資料模型（改既有 Prisma schema）

現有每個 model（`Reminder`、`Group`、`DisplaySetting`）都是全域單例/無主人概念，要改成：

```
model User {
  id        String   @id @default(uuid())
  email     String   @unique
  passwordHash String
  reminders Reminder[]
  groups    Group[]
  displaySetting DisplaySetting?
  devices   Device[]
}
```

- `Reminder` / `Group` / `DisplaySetting` 都要加 `userId` 外鍵，所有 Service 層查詢都要加上 `where: { userId }` 過濾——這是目前 `RemindersService`/`GroupsService`/`DisplaySettingsService` 全部要改的地方（目前 `DisplaySettingsService` 是「Get-or-Create 單例」邏輯，要改成「每個 user 一份」）。
- 資料庫可能要從 SQLite 換成 PostgreSQL/MySQL（SQLite 單檔案的寫入鎖機制在多使用者同時讀寫時不是好選擇；雲端服務通常回到 PostgreSQL——剛好是這個專案 Docker Compose 舊版本來用的，等於是繞回去)。

### 3. 多裝置同步機制

這是跟「多租戶」不同的另一塊——同一個 user 在桌面 + 手機上都要能看到一致的資料：

- **若兩端都即時連線雲端 API**（最簡單）：桌面版和手機版都直接讀寫雲端 API，不在本地存一份會漂移的副本，等同於把現在「桌面前端打本機後端」的模式換成「打雲端後端」。沒有離線模式，但沒有同步衝突問題。
- **若要支援離線使用**（桌面版現在的賣點之一）：本地要保留一份快取資料庫，加上「上線後合併」邏輯——需要設計變更追蹤（`updatedAt` 版本比對，或整合 CRDT/operational transform），這是同步機制裡最難的部分，衝突處理（例如兩端同時編輯同一個提醒）沒有簡單解法。
- 建議先做「無離線模式、直接打雲端 API」這個最簡版本，離線同步留到之後有需求再做。

### 4. 裝置註冊與推播（為 iOS 通知鋪路）

- `Device` model：記錄每個登入裝置的 push token（iOS 用 APNs device token）
- 後端在提醒資料變更或即將到期時，呼叫 APNs 發推播——包含兩種用途：
  - 一般推播（提醒內容），給使用者看到的通知
  - 靜默背景推播（`content-available: 1`），喚醒 iOS App 在背景重新計算並補排本地通知排程（解決前面討論過的「interval + 時段限制」通知數量問題）
- 需要申請 Apple Push Notification 憑證、管理 APNs 連線（可用 `@parse/node-apn` 或類似套件）

### 5. 部署基礎設施

- 選一個雲端主機（VPS / Render / Fly.io / Railway 等），跑 NestJS + PostgreSQL
- HTTPS 憑證（Let's Encrypt 或平台內建）
- 環境變數/機密管理（JWT secret、APNs 憑證、資料庫連線字串）
- 現有 `docker-compose.yml`（PostgreSQL 版本）可以作為雲端部署的起點，但要注意它已經跟目前 SQLite schema 不同步，需要先修回 PostgreSQL datasource 並補 migration
- 基本的備份機制（使用者資料存在雲端，資料遺失的影響比單機版嚴重很多）

### 6. 既有功能要重新檢視的地方

- `SchedulerService` 目前是「單機 Cron 掃描所有提醒」，多租戶之後掃描量會隨使用者數增加，長期需要注意效能（目前每 3 秒全表掃描的作法，使用者一多會需要優化，例如改成只查即將到期的 reminder 而非全表）
- 短月份二次確認（409 + `SHORT_MONTH_CONFIRMATION_REQUIRED`）、群組名稱重複檢查等既有驗證邏輯，只需要補上 `userId` 範圍限制（例如群組名稱要在同一 user 底下才算重複），邏輯本身不用重寫

---

## iOS 通知數量限制（更新版建議）

iOS 單一 App 上限 64 個「待觸發」通知，但這個數字算的是**通知規則數**，不是**觸發次數**——`UNCalendarNotificationTrigger` 設 `repeats: true` 後系統會自動依條件無限重複，只佔 1 個名額。因此：

| 重複模式 | 需要幾個通知名額 |
|---|---|
| `daily_time` | 1 個 |
| `weekly_day` | 依選中星期數，最多 7 個 |
| `monthly_day` | 1 個 |
| `interval`（無時段限制） | 1 個（`UNTimeIntervalNotificationTrigger` repeats=true）|
| `interval` + 時段限制（`activeFrom`/`activeUntil`） | 需拆成時段內每個時間點的個別 trigger，量可能很大 |

正常使用量下，前四種完全不會碰到 64 上限，**不是真正的架構風險**。真正棘手的只有「`interval` + 時段限制」這個組合，建議：

- 只預先排未來一小段時間（例如 24 小時）的觸發點，用完即補
- 利用上面第 4 項的**靜默背景推播**機制，讓雲端後端在需要時主動喚醒 App 補排程，不依賴使用者自己打開 App
- 若嫌複雜，可以先在 iOS 版閹割掉「時段限制」這個子功能（只保留「每 N 分鐘」不限時段），之後再補

---

## 路線選項（更新版）

雲端後端做好之後，iOS 客戶端的兩條路線都變得更可行，且工作量比初版評估小很多：

| | 路線 A：Tauri Mobile | 路線 B：原生 iOS（Swift/SwiftUI）|
|---|---|---|
| 後端問題 | **已解決**——打雲端 API，不需要本機 sidecar | 同左 |
| 可共用現有程式碼 | 前端 UI 元件、API 呼叫邏輯可大量沿用 | 僅 API 契約可參考，UI 需整個重寫 |
| 本地通知排程 | Tauri 沒有現成的 recurring local notification 封裝，大概率要自寫 Swift plugin 呼叫 `UserNotifications` | 原生直接用，整合度最好 |
| 開發成本 | 較低（延伸現有專案） | 較高（全新 codebase）|
| UI 手機體感 | 需另外做 RWD 改版，體感接近「縮小版桌面版」 | 完全貼合 iOS 設計規範 |

**建議**：雲端後端做完後，先嘗試路線 A（Tauri Mobile），因為最大的技術障礙（後端）已經解決，剩下主要是本地通知排程這塊需要少量原生 Swift 程式碼補洞，整體成本比重寫一個原生 App 低很多。若之後發現 Tauri Mobile 在通知/背景整合上問題太多，再考慮切到路線 B。

---

## 建議的分階段順序

1. **雲端後端**：帳號系統 + 多租戶 Prisma schema + 部署（第 1–5 項子系統）——這是所有後續工作的地基，且不管做不做 iOS 都該做
2. **桌面版接上雲端**：把現有 Tauri 桌面版從「打本機 sidecar」改成「打雲端 API」（可先保留本機模式作為離線 fallback，或直接要求登入才能用）
3. **iOS 客戶端（路線 A 優先）**：Tauri Mobile + 本地通知排程 + 裝置註冊推播
4. **（視需求）離線同步**：如果多裝置離線編輯衝突成為實際痛點，再補第 3 項子系統裡提到的同步機制——這塊建議不要在第一版就做，複雜度最高、也最難測試

每個階段都是獨立可交付的里程碑，不需要一次到位規劃到 iOS 上架才算完成。
