# RemindMe

雲端同步的桌面提醒管理工具。以 Tauri 2 封裝，提供系統常駐列圖示、原生彈窗提醒，以及玻璃毛霧風格的管理介面；資料存在自架的雲端後端，登入帳號後即可使用。

## 技術棧

| 層級 | 技術 |
|------|------|
| 桌面殼層 | Tauri 2.11.2（Rust） |
| 前端管理介面 | Next.js 16（App Router，靜態輸出）+ React 19 + Mantine v9 + @dnd-kit + lucide-react |
| 後端 API | NestJS 11 + Prisma 6，Email + 密碼 + JWT 認證 |
| 資料庫 | PostgreSQL 16 |
| 雲端部署 | Oracle Cloud Always Free ARM VM + Docker Compose + Caddy（自動 HTTPS） |

## 環境需求

- **Node.js** 20+
- **Docker**（本機開發用 PostgreSQL）
- **Rust + Cargo**（[rustup.rs](https://rustup.rs/) 一鍵安裝）
- **Windows**：WebView2（Windows 11 內建；Windows 10 需另行安裝）

## 開發模式（Hot Reload）

```bash
# Step 0 — 本機 PostgreSQL（專案根目錄）
docker compose up -d db
```

```bash
# Terminal 1 — 後端 API（port 3000）
cd backend
cp .env.example .env        # 第一次才需要
npm install
npm run prisma:migrate      # 第一次或 schema 有變更時
npm run start:dev
```

```bash
# Terminal 2 — 前端管理介面（port 3001）
cd frontend
npm install
npm run dev
```

```bash
# Terminal 3 — Tauri 桌面殼層
npx tauri dev
```

前端與 Tauri 預設都連 `http://localhost:3000`。Tauri 不會等待後端啟動；後端沒開時 App 照常開啟，只是 API 會失敗並顯示錯誤提示。第一次開啟需要先在登入頁註冊帳號。

> ⚠️ **macOS 上 `npx tauri dev` 目前無法編譯**：彈窗使用透明視窗（`popup_manager.rs` 的 `.transparent(true)`），在 macOS 需要 Tauri 的 `macos-private-api` feature。Windows 不受影響。要在 Mac 上開發桌面殼層，需在 `src-tauri/Cargo.toml` 的 tauri features 加上 `macos-private-api`，並在 `tauri.conf.json` 設定 `app.macOSPrivateApi: true`。

## 正式打包

推送版本 tag（例如 `v0.5.0`）後，GitHub Actions（`.github/workflows/release.yml`）會自動打包 Windows 安裝檔並發佈 Release。打包前需要在 GitHub repo 的 **Settings → Secrets and variables → Actions → Variables** 設定 `API_BASE_URL`（雲端後端網址，例如 `https://remindme-xxx.duckdns.org`，結尾不要加 `/`），沒設定或不是 `https://` 開頭時 workflow 會直接失敗。

要在本機手動打包：

```bash
export NEXT_PUBLIC_API_BASE_URL=https://<你的網域>   # 前端建置時寫入
export REMINDME_API_BASE_URL=https://<你的網域>      # Rust 編譯時寫入，兩者要相同
cd frontend && npm run build && cd ..
npx tauri build
```

產出的安裝檔位於 `src-tauri/target/release/bundle/`（Windows 為 `.msi` 與 `.exe`）。

## 雲端後端部署

- **申請帳號與建立主機**：`docs/cloud-setup-guide.md`（Oracle Cloud、SSH 金鑰、DuckDNS、GitHub 變數）
- **在主機上部署、更新、備份**：`deploy/README.md`

所有密碼與密鑰只放在主機上的 `deploy/.env`，**不要 commit**（repo 是公開的）。

## 功能總覽

### 帳號
- Email + 密碼註冊 / 登入 / 登出
- 每個帳號的提醒、群組、顯示設定互相隔離
- 同一帳號可在多台電腦登入，提醒會推送到所有在線裝置
- 排程依帳號的時區計算（註冊時自動帶入系統時區）

### 提醒管理
- 新增 / 編輯 / 刪除 / 啟用停用提醒
- **重複規則**：4 種模式可選
  - 每隔 N 分鐘（可限定時段與星期）
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
├── frontend/                    # Next.js App Router（管理介面，靜態輸出給 Tauri）
│   ├── src/app/                 # 主頁面、/login、/popup、/popup-manager
│   ├── src/components/          # TaskForm、DisplayPanel、SortableReminderRow…
│   ├── src/lib/                 # apiBase.ts（API 呼叫 + 自動 refresh）、auth.ts（登入狀態）
│   └── public/bg/               # 背景圖（background.jpg）
├── backend/                     # NestJS API
│   ├── src/auth/                # 註冊、登入、JWT guard
│   ├── src/reminders/           # 提醒 CRUD + 排序 + 延後
│   ├── src/groups/              # 群組
│   ├── src/display-settings/    # 顯示設定（每個帳號一份）
│   ├── src/scheduler/           # 排程引擎（每 3 秒依使用者時區檢查到期提醒，推給在線裝置）
│   ├── prisma/schema.prisma     # PostgreSQL schema
│   └── Dockerfile               # 正式環境映像檔
├── src-tauri/                   # Tauri 桌面殼層（Rust）
│   └── src/
│       ├── lib.rs               # 應用程式初始化、Tauri commands
│       ├── session.rs           # 登入 session（前端交給 Rust 輪詢器使用）
│       ├── scheduler.rs         # 帶 token 輪詢雲端 /scheduler/due 觸發彈窗
│       ├── popup.rs             # 彈窗位置計算（工作列感知、多螢幕）
│       ├── popup_manager.rs     # 彈窗視窗管理
│       └── tray.rs              # 系統常駐列圖示
├── deploy/                      # 雲端正式環境（compose、Caddyfile、部署與備份腳本）
├── docker-compose.yml           # 本機開發用 PostgreSQL
└── docs/                        # 架構、設計文件、開發計劃、雲端開設教學
```

## 自訂背景圖

UI 採玻璃毛霧風格，有底圖時視覺效果最佳。預設圖已附在 `frontend/public/bg/background.jpg`。

要換圖：用**柔色 / 失焦 / 抽象**（極光、mesh gradient、bokeh）風格的 JPG，命名為 `background.jpg` 覆蓋即可，無需重啟。

若圖片不存在，CSS 會 fallback 到內建靛紫漸層底色，不會白屏。

## Prisma 指令（在 `backend/` 目錄下執行，讀取 `backend/.env`）

```bash
npm run prisma:generate    # 重新產 Prisma Client
npm run prisma:migrate     # 建立 migration 並套用（開發環境，schema 變更時用）
npm run prisma:deploy      # 套用既有 migration（正式環境容器啟動時會自動執行）
npm run prisma:push        # 直接推 schema 到 DB，不產生 migration（僅限實驗用）
```

## API 文件

後端啟動後可在 `http://localhost:3000/docs` 查看 Swagger UI（右上角 Authorize 填入登入取得的 access token）。
