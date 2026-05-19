# 群組後端持久化 設計文件

**日期：** 2026-05-19
**範圍：** 修復 §1 群組無後端持久化（原本存 localStorage）

---

## 背景

目前群組名稱（`groupNames`）與提醒對應關係（`reminderGroupMap`）全存 localStorage，
換裝置或清除 storage 即消失，後端 schema 亦無 group 相關欄位。

---

## 決策

- 一則提醒只屬於一個群組（一對一）
- 空群組需要被持久化（需獨立 table）
- 群組不需要拖曳排序（按建立時間排序）
- 採用方案 A：獨立 `Group` table + `Reminder` 加 `groupId` FK

---

## 一、資料模型

### 新增 `Group` model

```prisma
model Group {
  id        String     @id @default(uuid())
  name      String     @unique
  createdAt DateTime   @default(now())
  reminders Reminder[]
}
```

### `Reminder` 新增 nullable FK

```prisma
model Reminder {
  // ... 現有欄位 ...
  groupId   String?  @map("group_id")
  group     Group?   @relation(fields: [groupId], references: [id], onDelete: SetNull)
}
```

`onDelete: SetNull`：刪除群組時，該群組所有 reminder 的 `groupId` 自動設為 `null`，無需額外程式邏輯。

---

## 二、後端 API

### 新增 `GroupsModule`

| Method   | Path           | 說明                                          |
|----------|----------------|-----------------------------------------------|
| `GET`    | `/groups`      | 取得所有群組，按 `createdAt ASC` 排序         |
| `POST`   | `/groups`      | 建立群組，body: `{ name: string }`            |
| `PATCH`  | `/groups/:id`  | 改名，body: `{ name: string }`                |
| `DELETE` | `/groups/:id`  | 刪除群組（reminders 自動歸入未分組）          |

**錯誤處理：**
- 名稱重複 → `409 Conflict`
- id 不存在 → `404 Not Found`

### 更新 Reminder API

- `POST /reminders`：body 新增 optional `groupId?: string`
- `PATCH /reminders/:id`：body 新增 optional `groupId?: string | null`（`null` = 移出群組）
- `GET /reminders`：回傳資料 include `group { id, name }`
- `groupId` 指向不存在的群組 → `400 Bad Request`

---

## 三、前端改動

### 移除

- `STORAGE_KEY_GROUP_NAMES`、`STORAGE_KEY_GROUP_MAP` 及所有 localStorage 群組讀寫
- `reminderGroupMap` state
- `groupsHydrated` state
- `groups` useMemo（改為直接從 API 資料組裝）

### 新增型別與 state

```ts
type Group = { id: string; name: string; createdAt: string }

const [groups, setGroups] = useState<Group[]>([])
const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
```

`selectedGroupId` 取代舊的 `selectedGroup`（string name → string id）。

### 資料流

- `loadAll` 同時打 `GET /reminders` 與 `GET /groups`
- `Reminder` 型別加 `groupId: string | null`
- 群組清單 = API 回傳的 `groups`；未分組 bucket = `reminders.filter(r => !r.groupId)`
- `createGroup` / `renameGroup` / `deleteGroup` 改呼叫對應 API，成功後重新 fetch groups
- `createReminderInGroup(groupId: string | null)` 接收 id 而非 name
- `buildReminderPayload` 加入 `groupId`

---

## 四、Migration 策略

1. 跑 `prisma migrate dev` 產生新 migration
2. 現有 reminder 的 `groupId` 預設為 `null`（歸入未分組），無需 data migration
3. 前端 localStorage 殘留資料自動失效（不再讀取），無需清除腳本

---

## 五、不在本次範圍內

- 群組拖曳排序
- 群組顏色/圖示
- 一則提醒屬於多個群組
