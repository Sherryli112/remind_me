# RemindMe

可本機自部署的桌面提醒管理工具。以 Tauri 2 封裝，提供系統常駐列圖示、原生彈窗提醒，以及玻璃毛霧風格的 Web 管理介面。

## 技術棧

| 層級 | 技術 |
|------|------|
| 桌面殼層 | Tauri 2.11.2（Rust） |
| 前端管理介面 | Next.js 16（App Router）+ React 19 + Mantine v9 + @dnd-kit + lucide-react |
| 後端 API | NestJS 11 + Prisma 6 |
| 資料庫 | SQLite（Production 存於 OS 應用程式資料目錄） |

## 環境需求

- **Node.js** 20+
- **Rust + Cargo**（[rustup.rs](https://rustup.rs/) 一鍵安裝）
- **Windows**：WebView2（Windows 11 內建；Windows 10 需另行安裝）

## 開發模式（Hot Reload）

開三個 Terminal，依序執行：

```bash
# Terminal 1 — 後端 API（port 3000）
cd backend
npm install
npm run start:dev
```

```bash
# Terminal 2 — 前端管理介面（port 3001）
cd frontend
npm install
npm run dev
```

```bash
# Terminal 3 — Tauri 桌面殼層（等後端就緒後啟動）
npx tauri dev
```

> Tauri dev 模式會輪詢 `http://localhost:3000/health`，最多等 60 秒。
> 請確保後端（Terminal 1）先出現 `Application is running on: http://[::1]:3000` 再執行 `npx tauri dev`。

## 正式打包

```bash
# Step 1：產 Next.js 靜態輸出（輸出到 frontend/out/）
cd frontend
npm run build

# Step 2：打包 Tauri 安裝檔
cd ..
npx tauri build
```

產出的安裝檔位於 `src-tauri/target/release/bundle/`（Windows 為 `.msi` 與 `.exe`）。

打包後的應用程式會在背景自動啟動內嵌的 NestJS 後端，資料庫（SQLite）存放於：

| 平台 | 路徑 |
|------|------|
| Windows | `%APPDATA%\com.funtime.remindme\remindme.db` |
| macOS | `~/Library/Application Support/com.funtime.remindme/remindme.db` |

## 功能總覽

### 提醒管理
- 新增 / 編輯 / 刪除 / 啟用停用提醒
- **重複規則**：4 種模式可選
  - 每隔 N 分鐘
  - 每天 HH:MM 固定時間
  - 每週（多選星期）
  - 每月（指定 1–31 號）
- 拖曳排序
- 群組分類

### 彈窗提醒
- 彈窗出現於螢幕角落（左上 / 右上 / 左下 / 右下）
- 自動定位於工作列上方，不會被系統工作列遮蓋
- 支援多螢幕，可指定彈窗要顯示在哪個螢幕
- 自動關閉倒計時（可自訂秒數）+ 進度條
- 延後（Snooze）功能

### 顯示設定
- 彈窗尺寸（小 / 中 / 大）
- 主題（亮色 / 暗色）
- 角落位置
- 目標螢幕
- 顯示 / 隱藏提醒內容文字
- 吉祥物圖示（鈴鐺 / 閃光 / 日曆時鐘）
- 即時 MonitorMockup 預覽

### 視窗限制
- 最小尺寸：860 × 600
- 最大尺寸：1920 × 1200

## 目錄結構

```
RemindMe/
├── frontend/                    # Next.js App Router（管理介面）
│   ├── src/app/                 # 主頁面、layout、popup 彈窗頁
│   ├── src/components/          # TaskForm、DisplayPanel、SortableReminderRow…
│   └── public/bg/               # 背景圖（background.jpg）
├── backend/                     # NestJS API
│   ├── src/reminders/           # 提醒 CRUD + 排序
│   ├── src/display-settings/    # 顯示設定
│   ├── src/scheduler/           # 排程引擎（每 30 秒輪詢到期提醒）
│   └── prisma/schema.prisma     # SQLite schema
├── src-tauri/                   # Tauri 桌面殼層（Rust）
│   └── src/
│       ├── lib.rs               # 應用程式初始化（dev/release 雙模式）
│       ├── popup.rs             # 彈窗視窗建立（工作列感知定位）
│       ├── scheduler.rs         # 輪詢後端 API 觸發彈窗
│       ├── sidecar.rs           # Release 模式啟動 NestJS 子行程
│       └── tray.rs              # 系統常駐列圖示
└── docs/                        # 設計文件與開發計劃
```

## 自訂背景圖

UI 採玻璃毛霧風格，有底圖時視覺效果最佳。預設圖已附在 `frontend/public/bg/background.jpg`。

要換圖：用**柔色 / 失焦 / 抽象**（極光、mesh gradient、bokeh）風格的 JPG，命名為 `background.jpg` 覆蓋即可，無需重啟。

若圖片不存在，CSS 會 fallback 到內建靛紫漸層底色，不會白屏。

## Prisma 指令（在 `backend/` 目錄下執行）

```bash
npm run prisma:generate    # 重新產 Prisma Client
npm run prisma:push        # 直接推 schema 到 DB（開發用，無 migration 檔）
npm run prisma:migrate     # 建立 migration 並套用（正式變更用）
```

## API 文件

後端啟動後可在 `http://localhost:3000/docs` 查看 Swagger UI。
