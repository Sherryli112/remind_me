# RemindMe

可自部署的桌面提醒管理工具。提供 Web 管理介面建立 / 編輯 / 排程提醒，搭配可自訂的顯示樣式預覽。

## 技術棧

- **Frontend**：Next.js 16（App Router）+ React 19 + Mantine v9 + @mantine/dates + @mantine/modals + @dnd-kit + lucide-react
- **Backend**：NestJS 11 + Prisma 6 + class-validator + Swagger UI
- **Database**：PostgreSQL 16
- **部署**：Docker Compose（含自動 schema sync）

## 快速啟動

### 一鍵啟動（推薦）

```bash
cp .env.example .env
docker compose up --build
```

啟動後：

- 前端管理介面：http://localhost:3001
- 後端 API：http://localhost:3000
- Swagger 文件：http://localhost:3000/docs
- PostgreSQL：localhost:5432（資料 volume：`remindme_pg_data`）

第一次啟動時 backend 容器 entrypoint 會自動跑 `prisma db push`，DB 與 schema 同步完成後再啟動 Nest。

### 本機 dev 模式（hot reload 較快）

只開 DB 容器，前後端跑在 host：

```bash
docker compose up -d db        # 只啟動 postgres

# Terminal 1 — Backend
cd backend
npm install
npm run prisma:push            # 第一次需推 schema
npm run start:dev              # 自動讀 ../.env

# Terminal 2 — Frontend
cd frontend
npm install
npm run dev                    # http://localhost:3000（或 next 安排的 port）
```

## 自訂背景圖

UI 採玻璃毛霧風格，需要一張底圖才能呈現折射效果。預設圖已附在 `frontend/public/bg/background.jpg`。

要換圖：

1. 從 [Unsplash](https://unsplash.com/) 等開源圖庫下載**柔色 / 失焦 / 抽象**（極光、mesh gradient、bokeh）的圖
2. 命名為 `background.jpg` 覆蓋 `frontend/public/bg/background.jpg`
3. 重新整理頁面即生效（無需重建容器）

若圖片不存在，CSS 會自動 fallback 到內建漸層底色，不會白屏。

## 目錄結構

```
RemindMe/
├── frontend/                # Next.js App Router
│   ├── src/app/             # 主頁面與 layout
│   ├── src/components/      # 元件（TaskForm、DisplayPanel、SortableReminderRow…）
│   └── public/bg/           # 背景圖位置
├── backend/                 # NestJS API
│   ├── src/reminders/       # 提醒 CRUD + 排序
│   ├── src/display-settings # 顯示設定
│   ├── prisma/schema.prisma # DB schema
│   └── entrypoint.sh        # 容器啟動腳本（自動同步 schema）
├── docker-compose.yml
└── .env.example
```

## Prisma 指令（backend 內）

```bash
npm run prisma:generate    # 重新產 client
npm run prisma:push        # 直接推 schema 到 DB（無 migration 檔）
npm run prisma:migrate     # 建立 migration（會問你 migration 名稱）
```

上述指令會透過 dotenv-cli 載入根目錄 `.env`。

## 環境變數

`.env.example` 已列出可調項：

| 變數 | 預設值 | 用途 |
|------|--------|------|
| `DB_NAME` | `remindme` | postgres 資料庫名 |
| `DB_USER` | `postgres` | postgres 帳號 |
| `DB_PASSWORD` | `postgres` | postgres 密碼 |
| `DB_PORT` | `5432` | postgres 對外 port |
| `DATABASE_URL` | `postgresql://...` | 由前 4 個變數組合，Prisma 用 |

前端：`NEXT_PUBLIC_API_BASE_URL`（docker-compose 內預設 `http://localhost:3000`）。

## 目前已實作功能（MVP）

- 提醒 CRUD（單次 / 重複）+ 啟用停用 + 拖曳排序
- 重複規則 4 模式：每隔 N 分鐘、每天 HH:MM、每週多選星期、每月 1-31 號
- 群組分類（前端 localStorage 持久化）
- 顯示設定（尺寸、主題、彈窗位置）+ 即時預覽
- 玻璃毛霧 + 磨砂雜訊質感（iOS 26 風）
- 編輯中表單 sessionStorage 自動保留

## 後續延伸（非 MVP）

- 吉祥物上傳（API + UI）
- 排程引擎 / 觸發事件 / 彈窗事件 API
- 桌面殼層（Electron 或 Tauri）+ 多螢幕
- 多提醒堆疊與展開
- 暗色模式
