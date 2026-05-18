# RemindMe MVP 開發任務清單

> 本文件由 `todo.md` 的已定案需求整理而成；不回寫原需求檔。
> 最後同步：2026-05-18

## 0. 範圍與里程碑

- MVP 目標：在 `macOS` 上完成可本地部署的提醒管理系統。
- 技術基線：`Next.js + NestJS + PostgreSQL + Docker + Swagger UI`。
- 關鍵能力：
  - 任務建立/編輯/刪除/啟用停用
  - 重複提醒 UI 規則（每月幾號 / 每週週幾 / 每日幾時幾分）
  - 桌面彈窗（獨立視窗）、snooze、多提醒堆疊與展開
  - 關頁後仍可提醒（需背景服務）

---

## 1. 後端任務（NestJS）

### 1.1 專案基礎
- [x] 建立 NestJS 專案模組：`reminders / display-settings / prisma`
- [ ] 建立 `scheduler` 模組（未開始）
- [ ] 建立 `assets` 模組（未開始）
- [x] 接入 PostgreSQL（Prisma，`prisma db push` 容器啟動自動執行）
- [x] 建立 Swagger UI 文件（`/docs`）與 DTO 驗證規則（class-validator）

### 1.2 資料模型（最小集）
- [x] `reminders`
  - `id`, `title`, `content`, `enabled`
  - `schedule_type`（one_time / recurring）
  - `one_time_at`（nullable）
  - `auto_close_enabled`, `auto_close_seconds`（每任務獨立）
  - `snooze_default_seconds`（預設 300，最大 600）
  - `sort_order`（手動排序用）
  - `end_at`（nullable）, `max_occurrences`（nullable）
  - `created_at`, `updated_at`
- [x] `recurrence_rules`
  - `reminder_id`
  - `rule_mode`（monthly_day / weekly_day / daily_time / **interval**）※ MVP spec 外多了 interval
  - `month_day`（1~31, nullable）
  - `week_days`（陣列，週幾多選）
  - `time_of_day`（HH:mm）
  - `interval_minutes`（interval 模式專用）
  - `active_from` / `active_until`（interval 限定時段）
- [x] `display_settings`（全域單筆）
  - 尺寸、主題、位置角落、目標螢幕 id、是否顯示內容
  - 吉祥物模式（system/custom）
- [x] `mascot_images`（schema 定義完成，無 API）
  - `id`, `filePath`, `mimeType`, `width`, `height`, `sizeBytes`

### 1.3 API 能力
- [x] 提醒 CRUD API（含啟用 `PATCH /:id/enable` / 停用 `PATCH /:id/disable`）
- [x] 排序 API（`POST /reminders/reorder`，批次更新 `sort_order`）
- [x] 重複規則 API（嵌入 reminder CRUD，4 種模式）
- [x] 顯示設定 API（`GET/PATCH /display-settings/current`）
- [ ] 吉祥物上傳 API（最多 5 張，`jpg/png/svg`，寬高 <= 600）
- [ ] 彈窗事件 API（close / snooze）

### 1.4 商業規則
- [x] 若規則為「每月 29~31 號」，回傳 `409 + { code: 'SHORT_MONTH_CONFIRMATION_REQUIRED' }`，前端 modal 二次確認
- [x] 短月無該日期時：該月份直接跳過，不補發（驗證邏輯已在；排程引擎待實作）
- [x] 不保留未讀歷史清單（MVP）
- [ ] 同任務未關閉時遇下一輪提醒：新增新彈窗實例（需排程引擎）

### 1.5 排程與觸發
- [ ] 建立排程引擎（每分鐘 tick 或 next-fire-time 機制）
- [ ] 支援 one-time + recurring 計算下一次觸發時間
- [ ] 支援 `end_at` / `max_occurrences` 停止條件
- [ ] 觸發後透過本機通道通知桌面彈窗服務

---

## 2. 前端任務（Next.js 管理介面）

### 2.1 版面與導覽
- [x] 可收合側邊欄（展開 160px / 收合 80px）+ 右側內容區；展開/收合狀態存 localStorage
  - ※ 原 spec 為固定 30/70 比例，改為可收合設計
- [x] 側邊欄功能：`顯示工具`、`任務工具`（含 icon + active 狀態）
- [x] 右側為設定表單 + 即時預覽區

### 2.2 顯示工具頁
- [x] 尺寸（大/中/小）、主題（明/暗）、角落位置設定
- [x] 目標螢幕欄位（佔位，說明「桌面殼層接通後啟用」）
- [x] 是否顯示內容切換
- [ ] 吉祥物設定（系統 emoji / 自訂圖片）
- [ ] 上傳前檢查格式與尺寸，超限即時提示
- [x] 設定變更即時預覽（DisplayPanel 內嵌 `MonitorMockup` 元件，螢幕框架 + 角落小彈窗）
  - ※ 原 spec 為頁面右下角 portal 彈窗；已改為內嵌螢幕示意圖；`DesktopPopupPreview.tsx` 為死代碼待清理

### 2.3 任務工具頁
- [x] 任務清單（新增/編輯/刪除/啟用停用，含 optimistic update）
- [x] 拖曳排序並儲存 `sort_order`（@dnd-kit，真 grip handle + DragOverlay）
- [x] 排程 UI 組合器：
  - [x] 每月幾號
  - [x] 每週週幾
  - [x] 每日幾時幾分
  - [x] 每隔 N 分鐘（interval，MVP spec 外擴充）
- [x] 結束日期、最大提醒次數設定
- [x] 每任務自動關閉設定（開關 + 時長）
- [x] 若選每月 `29~31` 號，送出前顯示確認提示

### 2.4 彈窗互動
- [ ] 每則彈窗兩按鈕：左 `稍後提醒`、右 `關閉`
- [ ] snooze 預設 5 分鐘，可調整但最大 10 分鐘
- [ ] 長內容預設截斷，點擊展開；超高區塊可捲動
- [ ] 多提醒堆疊：新提醒在上；超過 1 則僅顯示最高優先，提供展開按鈕與捲軸

---

## 3. 桌面彈窗與背景服務（macOS 先行）

- [ ] 建立桌面容器方案（Electron 或 Tauri 二擇一）
- [ ] 實作背景常駐程序，確保關閉管理頁後仍可觸發提醒
- [ ] 實作獨立小角落彈窗視窗（非瀏覽器通知）
- [ ] 支援指定螢幕顯示（全域目標螢幕）
- [ ] 與後端排程事件串接（本機 IPC / WebSocket 任選）

---

## 4. DevOps / Docker

- [x] 撰寫 `docker-compose`（web/api/db 三服務）
- [x] 提供初始化流程（容器啟動自動 `prisma db push`）
- [x] 提供 `.env.example`
- [x] 補上本地啟動文件（README：一鍵啟動、本機 dev 模式、自訂背景圖說明）

---

## 5. 測試與驗收清單

### 5.1 核心功能驗收
- [ ] 可建立單次提醒並在指定時間彈窗
- [ ] 可建立 3 種重複規則並正常觸發
- [ ] 每任務可獨立設定自動關閉時長
- [ ] snooze 可延後提醒且上限生效（<=10 分鐘）
- [ ] 同任務未關閉時，下一次觸發會新增彈窗
- [ ] 多提醒可展開/收合，超出可捲動

### 5.2 邊界情境驗收
- [ ] 每月 31 號規則在 2 月會跳過
- [ ] 建立每月 29~31 號時會顯示確認提示
- [ ] 圖片上傳格式/尺寸超限會被阻擋
- [ ] 關閉管理頁後仍可觸發提醒

### 5.3 回歸驗收
- [ ] 重啟後設定與任務仍保留
- [ ] 停用任務不觸發提醒
- [ ] 過期任務樣式正確（灰底）

---

## 6. 建議開發順序（兩週示意）

- 第 1-2 天：資料模型、CRUD API、Swagger
- 第 3-4 天：排程引擎 + 觸發事件
- 第 5-6 天：任務工具頁 + 排程 UI + 拖曳排序
- 第 7-8 天：顯示工具頁 + 吉祥物上傳 + 即時預覽
- 第 9-10 天：桌面彈窗服務 + 背景常駐 + 多螢幕
- 第 11-12 天：整合測試、邊界情境修正、文件補齊

---

## 7. 非 MVP（先記錄，不實作）

- 跨平台安裝包（Windows / Linux）
- 匯出/匯入（備份還原）功能（目標 v2.0）
- 標籤 / 分類 / 附件欄位

---

## 8. 已完成實作紀錄（前端）

- [x] 主版面調整為可收合側邊欄（展開 160px / 收合 80px），收合狀態存 localStorage。
- [x] 側邊欄工具按鈕產品化（active 狀態、hover 動畫、icon + label）。
- [x] 暗色模式支援（`globals.css` 完整暗色 surface/body/Divider 樣式，側邊欄底部 Sun/Moon 切換按鈕）。
- [x] 顯示工具頁：
  - [x] 尺寸 / 主題 / 角落 / 顯示內容設定完整。
  - [x] 即時預覽改為 `MonitorMockup` 內嵌元件（螢幕框架 + 角落彈窗，含亮/暗兩套外觀，即時反映表單標題與內容）。
  - [x] 設定儲存提示為 Notification toast，成功/失敗顏色區分。
  - [x] 未儲存設定切換工具後回復已儲存值（避免草稿殘留）。
- [x] 任務工具流程：任務清單 → 編輯頁。
  - [x] 群組可新增、改名、刪除（持久化於 localStorage）。
  - [x] 群組內可新增提醒。
  - [x] 提醒項目可編輯、刪除、啟用/停用（含 optimistic update）。
  - [x] 返回按鈕（ArrowLeft ActionIcon）取代麵包屑。
- [x] 拖曳排序（@dnd-kit）：
  - [x] GripVertical 為真 drag handle（最左側）。
  - [x] DragOverlay 漂浮卡 + 原位置 ghost placeholder。
  - [x] surface-fade-in 改為 opacity-only 動畫，修復 dnd-kit containing block 偏移 bug。
- [x] 通知列加入重試按鈕（`onRetry` callback + RotateCcw 圖示）。
- [x] 重複規則模式選擇器下方加提示文字「目前每個提醒僅支援一條重複規則」。
- [x] UI 套件遷移至 Mantine v9（含 iOS 26 風玻璃 surface 系統）。
  - [x] 階段一（Provider/theme）：完成。
  - [x] 階段二（DisplayPanel）：完成。
  - [x] 階段三（TaskForm / page.tsx / DesktopPopupPreview）：完成。
  - [x] 階段四（清掉所有舊 `*.module.css`）：完成。
  - [x] 暗色模式 CSS 補完（surface / body / Divider）：完成。
- [x] Hydration 問題修正（`sidebarCollapsed` 改為 stable 初始值 + client effect 同步 localStorage）。

---

## 9. 已知問題（待修復，詳見 `待修復.md`）

### 🔴 嚴重
- [ ] **群組無後端持久化**：`groupNames` / `reminderGroupMap` 目前存 localStorage，重新整理會保留，但換裝置或清 storage 即消失；後端無 group 欄位（`待修復.md` §1）。
- [ ] **未分組新增提醒消失 bug**：`selectedGroup === '未分組'` 時送出會讓新提醒兩邊都收不到（`待修復.md` UX-3）。
- [ ] **nullable 欄位 update 用 `??` 導致無法清空**：`endAt` / `maxOccurrences` 傳 `null` 清空時被 fallback 舊值（`待修復.md` §3，`reminders.service.ts`）。

### 🟡 中等
- [ ] `DesktopPopupPreview.tsx` 為死代碼（portal 預覽已棄用，待刪除）（`待修復.md` §4）。
- [ ] 短月份確認旗標 `skipShortMonthConfirmation` 未持久化，每次編輯都重複觸發（`待修復.md` §5）。
- [ ] 目標螢幕選擇器為純文字佔位，`mascotMode = custom` 無對應 UI（`待修復.md` §7）。
- [ ] 刪除無防呆確認 modal（`待修復.md` UX-4）。
- [ ] 群組命名 / 重命名 input 不支援 Enter 送出（`待修復.md` UX-5）。
- [ ] 空白狀態缺引導說明（`待修復.md` UX-2）。
- [ ] 編輯中重整頁丟失未存表單（`待修復.md` UX-14）。

### ⚪ 輕量
- [ ] 自動關閉 / snooze 秒數缺即時換算提示（`待修復.md` UX-12）。
- [ ] 啟用/停用切換缺 optimistic revert on error（`待修復.md` UX-16）。
