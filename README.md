# RemindMe

![CI](https://github.com/Sherryli112/remind_me/actions/workflows/ci.yml/badge.svg)

雲端同步的桌面提醒管理工具。以 Tauri 2 封裝（Windows、macOS），提供系統常駐列圖示、原生彈窗提醒，以及玻璃毛霧風格的管理介面。不登入就能用（資料存在這台電腦）；登入帳號後改用自架雲端後端的資料，多台電腦共用，手機也可以用瀏覽器開同一個網址管理提醒。

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
- **macOS**：Xcode Command Line Tools（`xcode-select --install`）

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
# Terminal 3 — Tauri 桌面殼層（專案根目錄）
npx @tauri-apps/cli@2 dev
```

前端與 Tauri 預設都連 `http://localhost:3000`。只測本機模式（不登入）時不需要 PostgreSQL 和後端，只要前端加上 Tauri；要測雲端模式才需要 Step 0 和 Terminal 1，再從主畫面的「登入以使用雲端同步」註冊帳號。

> repo 裡沒有安裝 `@tauri-apps/cli`，直接打 `npx tauri` 會抓到 npm 上無關的舊套件，請用 `npx @tauri-apps/cli@2`（或 `cargo install tauri-cli --version '^2'` 後用 `cargo tauri dev`）。
>
> dev 版（debug build）不會自動啟用開機自動啟動，只有正式版第一次啟動時會。在 dev 版手動打開過的話，記得關掉（它會指向 `src-tauri/target/debug/app`）。
>
> macOS 用了 `macOSPrivateApi`（透明彈窗需要），所以不能上架 Mac App Store，但可以自行簽章與公證後散佈。

```bash
# 測試
cd backend && npm test          # 單元測試
cd frontend && npm test         # 前端測試
# 後端 e2e 需要 PostgreSQL：先起 DB，再執行
cd backend && npx prisma migrate deploy && npm run test:e2e
# 只檢查 lint 不改檔（npm run lint 會帶 --fix 直接改檔）
cd backend && npx eslint "{src,apps,libs,test}/**/*.ts"
```

push 到 main 或開 PR 時，GitHub Actions（`.github/workflows/ci.yml`）會自動跑後端、前端的 lint、測試、build，以及 Windows 上的 `cargo check`。後端 lint 目前還有既有錯誤，先設成不擋 CI。

## 正式打包

推送版本 tag（例如 `v0.5.0`）後，GitHub Actions（`.github/workflows/release.yml`）會自動打包 Windows 安裝檔並發佈 Release。打包前需要在 GitHub repo 的 **Settings → Secrets and variables → Actions → Variables** 設定 `API_BASE_URL`（雲端後端網址，例如 `https://remindme-xxx.duckdns.org`，結尾不要加 `/`），沒設定或不是 `https://` 開頭時 workflow 會直接失敗。

要在本機手動打包：

```bash
export NEXT_PUBLIC_API_BASE_URL=https://<你的網域>   # 前端建置時寫入
export REMINDME_API_BASE_URL=https://<你的網域>      # Rust 編譯時寫入，兩者要相同
cd frontend && npm run build && cd ..
npx @tauri-apps/cli@2 build
```

產出的安裝檔位於 `src-tauri/target/release/bundle/`（Windows 為 `.msi` 與 `.exe`，macOS 為 `.app` 與 `.dmg`，未簽章）。

## 雲端後端部署

- **申請帳號與建立主機**：`docs/cloud-setup-guide.md`（Oracle Cloud、SSH 金鑰、DuckDNS、GitHub 變數）
- **在主機上部署、更新、備份**：`deploy/README.md`

所有密碼與密鑰只放在主機上的 `deploy/.env`，**不要 commit**（repo 是公開的）。

Caddy 在同一個網域同時提供 API 和網頁版：API 路徑轉給後端，其他路徑是前端靜態檔。後端新增 `@Controller` 時，要同步更新 `deploy/Caddyfile` 的 `@api` 路徑清單。

## 功能總覽

### 本機模式（不登入）
- 桌面版打開就能用，不需要帳號，也不需要網路
- 資料存在這台電腦：`local.db`（macOS 在 `~/Library/Application Support/com.funtime.remindme/`，Windows 在 `%APPDATA%\com.funtime.remindme\`）
- 舊版（內附本機後端的版本）的 `remindme.db` 會在第一次啟動時自動匯入，然後改名為 `remindme.db.imported`
- 登入後改用雲端帳號的資料，本機資料**不會合併或上傳**，但會保留，登出後回來
- 登入過期時自動回到本機模式，並提示重新登入

### 帳號（雲端模式）
- Email + 密碼註冊 / 登入 / 登出
- 每個帳號的提醒、群組、顯示設定互相隔離
- 同一帳號可在多台電腦登入，提醒會推送到所有在線裝置
- 排程依帳號的時區計算（註冊時自動帶入系統時區）

### 手機網頁版
- 手機瀏覽器打開 `https://<你的網域>`，用桌面版同一個帳號登入
- 可以新增、修改、刪除、啟用停用提醒，管理群組，改顯示設定（會同步到桌面 App）
- **不會跳通知**，彈窗提醒仍由桌面 App 顯示
- iPhone Safari 可以「分享 → 加入主畫面」
- 手機上不支援拖曳排序，請在桌面版排

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
│   ├── src/app/                 # 主頁面、/login、/popup、/popup-manager、manifest（PWA）
│   ├── src/components/          # TaskForm、DisplayPanel、SortableReminderRow、MobileShell…
│   ├── src/lib/                 # apiBase.ts（API 呼叫 + 自動 refresh）、auth.ts（登入狀態）、platform.ts（是否在桌面 App 內）
│   ├── Dockerfile               # 網頁版映像檔（建置前端 + caddy:2）
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
