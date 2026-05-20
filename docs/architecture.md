# RemindMe 架構文件

## 概覽

RemindMe 是一個可自部署的桌面提醒管理工具，採用前後端分離架構，以 Docker Compose 容器化部署。

```
┌─────────────────────────────────────────────────────────┐
│                     Docker Compose                       │
│                                                         │
│  ┌──────────────┐    ┌──────────────┐   ┌───────────┐  │
│  │   Frontend   │───▶│   Backend    │──▶│ PostgreSQL│  │
│  │  Next.js 16  │    │  NestJS 11   │   │    16     │  │
│  │  :3001       │    │  :3000       │   │  :5450    │  │
│  └──────────────┘    └──────────────┘   └───────────┘  │
└─────────────────────────────────────────────────────────┘
```

---

## 技術棧

### 前端

| 項目 | 版本 / 說明 |
|------|------------|
| 框架 | Next.js 16（App Router）+ React 19 |
| UI 庫 | Mantine v9 + @mantine/dates + @mantine/modals |
| 拖曳排序 | @dnd-kit/core + @dnd-kit/sortable |
| 圖標 | lucide-react |
| 語言 | TypeScript 5 |
| 字體 | Geist（Google Fonts）|

### 後端

| 項目 | 版本 / 說明 |
|------|------------|
| 框架 | NestJS 11（模塊化架構）|
| ORM | Prisma 6 |
| 資料庫 | PostgreSQL 16 |
| 驗證 | class-validator + class-transformer |
| API 文檔 | Swagger（@nestjs/swagger）|
| 測試 | Jest 30 |
| 語言 | TypeScript 5 |

---

## 目錄結構

```
RemindMe/
├── frontend/                   # Next.js 前端應用
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx        # 主頁面（清單 + 編輯器）
│   │   │   ├── layout.tsx      # 根布局（Mantine Provider）
│   │   │   ├── globals.css     # 全局樣式（玻璃毛霧效果）
│   │   │   └── theme.ts        # Mantine 主題配置
│   │   └── components/
│   │       ├── TaskForm.tsx         # 提醒表單
│   │       ├── DisplayPanel.tsx     # 顯示設定預覽面板
│   │       ├── SortableReminderRow.tsx  # 可拖曳提醒行
│   │       └── StepperNumberInput.tsx   # 數字步進輸入器
│   ├── public/bg/background.jpg   # 背景圖（選填，有 fallback）
│   └── Dockerfile
│
├── backend/                    # NestJS 後端 API
│   ├── src/
│   │   ├── reminders/          # 提醒模塊
│   │   ├── groups/             # 群組模塊
│   │   ├── display-settings/   # 顯示設定模塊
│   │   ├── prisma/             # Prisma Service
│   │   └── app.module.ts       # 根模塊
│   ├── prisma/
│   │   ├── schema.prisma       # 資料庫 Schema
│   │   └── migrations/         # 遷移記錄
│   ├── entrypoint.sh           # 容器入口（prisma db push）
│   └── Dockerfile
│
├── docker-compose.yml
├── .env                        # 環境變數（本地）
└── .env.example                # 環境變數範本
```

---

## 資料庫 Schema

### 實體關係圖

```
DisplaySetting (1) ──── (*) MascotImage
Group (1) ──── (*) Reminder (*)──── (*) RecurrenceRule
```

### Group（群組）

| 欄位 | 型別 | 說明 |
|------|------|------|
| id | UUID | 主鍵 |
| name | String | 唯一，群組名稱 |
| createdAt | DateTime | 建立時間 |

### Reminder（提醒）

| 欄位 | 型別 | 說明 |
|------|------|------|
| id | UUID | 主鍵 |
| title | VarChar(120) | 標題（必填）|
| content | String | 內容（可選）|
| enabled | Boolean | 是否啟用，預設 true |
| scheduleType | ScheduleType | one_time \| recurring |
| oneTimeAt | DateTime? | 單次提醒時間 |
| autoCloseEnabled | Boolean | 自動關閉，預設 false |
| autoCloseSeconds | Int | 自動關閉秒數（1–600，預設 60）|
| snoozeDefaultSeconds | Int | 延後秒數（60–600，預設 300）|
| sortOrder | Int | 排序優先級 |
| endAt | DateTime? | 重複結束時間 |
| maxOccurrences | Int? | 最多重複次數 |
| groupId | UUID? | 外鍵，可為 null |

### RecurrenceRule（重複規則）

| 欄位 | 型別 | 說明 |
|------|------|------|
| id | UUID | 主鍵 |
| ruleMode | RuleMode | interval \| daily_time \| weekly_day \| monthly_day |
| monthDay | Int? | 日期（1–31，monthly_day 必填）|
| weekDays | Int[] | 星期（0=週日 ~ 6=週六）|
| timeOfDay | VarChar(5)? | HH:mm 格式 |
| intervalMinutes | Int? | 間隔分鐘（1–1440）|
| activeFrom | VarChar(5)? | 時段起（HH:mm）|
| activeUntil | VarChar(5)? | 時段迄（HH:mm）|
| reminderId | UUID | 外鍵（刪除級聯）|

### DisplaySetting（顯示設定，全局單例）

| 欄位 | 型別 | 預設值 |
|------|------|--------|
| id | UUID | — |
| size | PopupSize | medium |
| theme | PopupTheme | light |
| corner | PopupCorner | bottom_right |
| showContent | Boolean | true |
| targetScreenId | VarChar(100)? | — |
| mascotMode | MascotMode | system |
| mascotIcon | MascotIcon | bell_ring |

### MascotImage（吉祥物圖片）

| 欄位 | 型別 | 說明 |
|------|------|------|
| id | UUID | 主鍵 |
| filePath | VarChar(255) | 檔案路徑 |
| mimeType | VarChar(32) | MIME 類型 |
| width / height | Int | 圖片尺寸 |
| sizeBytes | Int | 檔案大小 |
| displaySettingId | UUID | 外鍵（刪除級聯）|

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

## API 端點

基礎 URL：`http://localhost:3000`  
Swagger 文檔：`http://localhost:3000/docs`

### 提醒（/reminders）

| 方法 | 路徑 | 說明 |
|------|------|------|
| POST | /reminders | 建立提醒 |
| GET | /reminders | 取得所有提醒（按 sortOrder 排序）|
| GET | /reminders/:id | 取得單一提醒 |
| PATCH | /reminders/:id | 更新提醒 |
| DELETE | /reminders/:id | 刪除提醒 |
| PATCH | /reminders/:id/enable | 啟用提醒 |
| PATCH | /reminders/:id/disable | 停用提醒 |
| POST | /reminders/reorder | 批次調整排序 |

### 群組（/groups）

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | /groups | 取得所有群組 |
| POST | /groups | 建立群組 |
| PATCH | /groups/:id | 重命名群組 |
| DELETE | /groups/:id | 刪除群組（提醒的 groupId 設為 null）|

### 顯示設定（/display-settings）

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | /display-settings/current | 取得設定（不存在時自動建立預設值）|
| PATCH | /display-settings/current | 更新設定 |

### 特殊 HTTP 狀態碼

| 狀態碼 | 情境 |
|--------|------|
| 409 Conflict + `SHORT_MONTH_CONFIRMATION_REQUIRED` | monthly_day 為 29–31 時，需二次確認 |
| 409 Conflict | 群組名稱重複 |

---

## 後端模塊架構

```
AppModule
├── ConfigModule (全局環境變數)
├── PrismaModule
│   └── PrismaService (extends PrismaClient)
├── RemindersModule
│   ├── RemindersController
│   └── RemindersService (含驗證邏輯)
├── DisplaySettingsModule
│   ├── DisplaySettingsController
│   └── DisplaySettingsService (單例 Get-or-Create)
└── GroupsModule
    ├── GroupsController
    └── GroupsService
```

**全局配置（main.ts）**：
- CORS 全開
- 全局驗證管道（whitelist + transform + forbidNonWhitelisted）

---

## 前端架構

### 頁面結構

主頁面（`page.tsx`）採用單頁應用模式，包含兩個主視圖：

```
App Shell
├── Sidebar（可摺疊，localStorage 持久化）
│   ├── 導覽項目（All / 各群組）
│   └── 顯示設定按鈕
├── List View（提醒清單）
│   ├── SortableReminderRow（@dnd-kit 拖曳）
│   └── 群組分組顯示
└── Editor View（新建/編輯表單）
    └── TaskForm（4 種重複模式）
```

### 狀態管理

- 使用 React useState 管理 25+ 個狀態
- 表單草稿：sessionStorage 自動保留編輯中的內容
- 側邊欄摺疊狀態：localStorage 持久化
- 啟用/停用提醒：樂觀更新（不等待 API 回應）

### 重複規則表單模式

```
scheduleType = one_time
└── oneTimeAt（日期時間選擇器）

scheduleType = recurring
├── ruleMode = interval（每 N 分鐘）
│   ├── intervalMinutes
│   ├── 可選時段（activeFrom / activeUntil）
│   └── 可選星期過濾（weekDays）
├── ruleMode = daily_time（每天固定時間）
│   └── timeOfDay
├── ruleMode = weekly_day（每週特定星期）
│   ├── weekDays（多選）
│   └── timeOfDay
└── ruleMode = monthly_day（每月固定日期）
    ├── monthDay（1–31）
    └── timeOfDay
```

### 視覺設計系統

- **風格**：iOS 26 玻璃毛霧（Glassmorphism）
- **主色**：靛藍（Indigo）
- **背景**：`public/bg/background.jpg`（選填），fallback 為多層漸層
- **毛霧層**：
  - Main：60px blur + 180% saturate
  - `.surface`：80px blur + 220% saturate，半透白
  - `.surface-strong`：110px blur + 230% saturate

---

## 部署配置

### Docker Compose 服務

| 服務 | Image | 對外端口 |
|------|-------|----------|
| db | postgres:16-alpine | 5450 |
| backend | node:20-alpine | 3000 |
| frontend | node:20-alpine | 3001（容器內 3000）|

### 啟動流程

```
1. db 啟動並通過 healthcheck（pg_isready）
2. backend 啟動
   └── entrypoint.sh 執行 prisma db push（自動同步 Schema）
   └── npm run start:dev
3. frontend 啟動
   └── npm run dev
```

### 環境變數

| 變數 | 說明 | 預設值 |
|------|------|--------|
| DB_NAME | 資料庫名 | remindme |
| DB_USER | 資料庫用戶 | postgres |
| DB_PASSWORD | 資料庫密碼 | postgres |
| DB_PORT | 對外映射端口 | 5450 |
| DATABASE_URL | Prisma 連線字串 | — |
| NEXT_PUBLIC_API_BASE_URL | 前端 API 基礎 URL | http://localhost:3000 |

---

## 快速啟動

### 方式 A：Docker Compose（推薦）

```bash
cp .env.example .env
docker compose up --build
```

| 服務 | URL |
|------|-----|
| 前端 | http://localhost:3001 |
| API | http://localhost:3000 |
| Swagger | http://localhost:3000/docs |

### 方式 B：本地開發

```bash
# 只啟動資料庫
docker compose up -d db

# Terminal 1 — 後端
cd backend
npm install
npm run prisma:push
npm run start:dev

# Terminal 2 — 前端
cd frontend
npm install
npm run dev
```

---

## 資料庫遷移記錄

| 遷移 | 說明 |
|------|------|
| 20260519033637_init | 初始化所有核心表 |
| 20260519054846_add_group_model | 添加 Group 表與外鍵關係 |
| 20260519055351_add_reminder_group_index | 在 groupId 欄位建立索引 |
| 20260519102205_add_mascot_icon | 添加 MascotIcon enum 與 mascotIcon 欄位 |

---

## 已實現功能

- 提醒 CRUD + 啟用/停用 + 拖曳排序
- 4 種重複規則（interval / daily_time / weekly_day / monthly_day）
- 群組分類管理
- 短月份二次確認機制（29–31 日）
- 顯示設定（尺寸、主題、位置、吉祥物圖標）+ 即時預覽
- 表單草稿自動保留（sessionStorage）
- 玻璃毛霧 UI，全繁體中文介面

## 待實現功能

- 吉祥物自訂圖片上傳（API + UI）
- 排程引擎 / 觸發事件 / 彈窗事件 API
- 桌面殼層（Electron 或 Tauri）
- 多螢幕支持（targetScreenId 預留）
- 暗色模式完整主題
