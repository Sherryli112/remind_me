# 群組後端持久化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 將群組資料從 localStorage 遷移至後端 PostgreSQL，新增 `Group` table 及完整 CRUD API，前端改用 API 管理群組狀態。

**Architecture:** Prisma 新增 `Group` model，`Reminder` 加 nullable `groupId` FK（`onDelete: SetNull`）；後端新增 `GroupsModule` 提供 4 支 REST API；前端移除 localStorage 群組邏輯，改用 API fetch + 本地 state 同步。

**Tech Stack:** NestJS, Prisma (PostgreSQL), Next.js (React), class-validator, @nestjs/swagger

---

## 檔案一覽

**後端 — 新增：**
- `backend/src/groups/dto/create-group.dto.ts`
- `backend/src/groups/groups.service.ts`
- `backend/src/groups/groups.controller.ts`
- `backend/src/groups/groups.module.ts`

**後端 — 修改：**
- `backend/prisma/schema.prisma`
- `backend/src/app.module.ts`
- `backend/src/reminders/dto/create-reminder.dto.ts`
- `backend/src/reminders/dto/update-reminder.dto.ts`
- `backend/src/reminders/reminders.service.ts`

**前端 — 修改：**
- `frontend/src/app/page.tsx`

---

## Task 1：更新 Prisma Schema + Migration

**Files:**
- Modify: `backend/prisma/schema.prisma`

- [ ] **Step 1：在 schema.prisma 新增 Group model 並在 Reminder 加 groupId FK**

在 `backend/prisma/schema.prisma` 的 `model Reminder` **之前**插入以下新 model，再修改 `Reminder` model：

```prisma
model Group {
  id        String     @id @default(uuid())
  name      String     @unique
  createdAt DateTime   @default(now())
  reminders Reminder[]
}
```

在 `model Reminder` 的 `recurrenceRules` 行**之後**加入：

```prisma
  groupId   String?        @map("group_id")
  group     Group?         @relation(fields: [groupId], references: [id], onDelete: SetNull)
```

最終 `model Reminder` 的欄位順序：

```prisma
model Reminder {
  id                   String           @id @default(uuid())
  title                String           @db.VarChar(120)
  content              String           @default("")
  enabled              Boolean          @default(true)
  scheduleType         ScheduleType     @default(one_time)
  oneTimeAt            DateTime?
  autoCloseEnabled     Boolean          @default(false)
  autoCloseSeconds     Int              @default(60)
  snoozeDefaultSeconds Int              @default(300)
  sortOrder            Int              @default(0)
  endAt                DateTime?
  maxOccurrences       Int?
  recurrenceRules      RecurrenceRule[]
  groupId              String?          @map("group_id")
  group                Group?           @relation(fields: [groupId], references: [id], onDelete: SetNull)
  createdAt            DateTime         @default(now())
  updatedAt            DateTime         @updatedAt
}
```

- [ ] **Step 2：執行 migration**

```bash
cd backend
npx dotenv -e "../.env" -- npx prisma migrate dev --name add-group-model
```

預期輸出包含：
```
Applying migration `..._add_group_model`
Your database is now in sync with your schema.
✔ Generated Prisma Client
```

- [ ] **Step 3：Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/
git commit -m "feat(db): add Group model and groupId FK to Reminder"
```

---

## Task 2：建立 Groups CRUD 模組（後端）

**Files:**
- Create: `backend/src/groups/dto/create-group.dto.ts`
- Create: `backend/src/groups/groups.service.ts`
- Create: `backend/src/groups/groups.controller.ts`
- Create: `backend/src/groups/groups.module.ts`
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1：建立 DTO**

新增 `backend/src/groups/dto/create-group.dto.ts`：

```typescript
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Length } from 'class-validator';

export class CreateGroupDto {
  @ApiProperty({ maxLength: 60 })
  @IsString()
  @IsNotEmpty()
  @Length(1, 60)
  name: string;
}
```

- [ ] **Step 2：建立 Service**

新增 `backend/src/groups/groups.service.ts`：

```typescript
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateGroupDto } from './dto/create-group.dto';

@Injectable()
export class GroupsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.group.findMany({ orderBy: { createdAt: 'asc' } });
  }

  async create(dto: CreateGroupDto) {
    const existing = await this.prisma.group.findUnique({ where: { name: dto.name } });
    if (existing) throw new ConflictException('群組名稱已存在');
    return this.prisma.group.create({ data: { name: dto.name } });
  }

  async rename(id: string, dto: CreateGroupDto) {
    const group = await this.prisma.group.findUnique({ where: { id } });
    if (!group) throw new NotFoundException('群組不存在');
    const conflict = await this.prisma.group.findUnique({ where: { name: dto.name } });
    if (conflict && conflict.id !== id) throw new ConflictException('群組名稱已存在');
    return this.prisma.group.update({ where: { id }, data: { name: dto.name } });
  }

  async remove(id: string) {
    const group = await this.prisma.group.findUnique({ where: { id } });
    if (!group) throw new NotFoundException('群組不存在');
    await this.prisma.group.delete({ where: { id } });
    return { success: true };
  }
}
```

- [ ] **Step 3：建立 Controller**

新增 `backend/src/groups/groups.controller.ts`：

```typescript
import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CreateGroupDto } from './dto/create-group.dto';
import { GroupsService } from './groups.service';

@ApiTags('groups')
@Controller('groups')
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  @Get()
  @ApiOperation({ summary: '取得所有群組（按建立時間排序）' })
  findAll() {
    return this.groupsService.findAll();
  }

  @Post()
  @ApiOperation({ summary: '建立群組' })
  create(@Body() dto: CreateGroupDto) {
    return this.groupsService.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: '重命名群組' })
  rename(@Param('id') id: string, @Body() dto: CreateGroupDto) {
    return this.groupsService.rename(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '刪除群組（Reminder 自動歸入未分組）' })
  remove(@Param('id') id: string) {
    return this.groupsService.remove(id);
  }
}
```

- [ ] **Step 4：建立 Module**

新增 `backend/src/groups/groups.module.ts`：

```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { GroupsController } from './groups.controller';
import { GroupsService } from './groups.service';

@Module({
  imports: [PrismaModule],
  controllers: [GroupsController],
  providers: [GroupsService],
})
export class GroupsModule {}
```

- [ ] **Step 5：在 AppModule 註冊 GroupsModule**

修改 `backend/src/app.module.ts`：

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DisplaySettingsModule } from './display-settings/display-settings.module';
import { GroupsModule } from './groups/groups.module';
import { PrismaModule } from './prisma/prisma.module';
import { RemindersModule } from './reminders/reminders.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../.env', '.env'],
    }),
    PrismaModule,
    RemindersModule,
    DisplaySettingsModule,
    GroupsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

- [ ] **Step 6：確認後端自動重啟後 API 可用**

```bash
curl http://localhost:3000/groups
```

預期輸出：`[]`

- [ ] **Step 7：Commit**

```bash
git add backend/src/groups/ backend/src/app.module.ts
git commit -m "feat(api): add Groups CRUD module (GET/POST/PATCH/DELETE /groups)"
```

---

## Task 3：更新 Reminder DTO + Service 支援 groupId

**Files:**
- Modify: `backend/src/reminders/dto/create-reminder.dto.ts`
- Modify: `backend/src/reminders/dto/update-reminder.dto.ts`
- Modify: `backend/src/reminders/reminders.service.ts`

- [ ] **Step 1：在 CreateReminderDto 新增 groupId 欄位**

在 `backend/src/reminders/dto/create-reminder.dto.ts` 的 `skipShortMonthConfirmation` 屬性**之前**加入：

```typescript
  @ApiPropertyOptional({ description: '群組 id，省略或 null 表示未分組' })
  @IsOptional()
  @IsString()
  groupId?: string;
```

- [ ] **Step 2：更新 UpdateReminderDto，允許 groupId 傳 null（明確移出群組）**

將 `backend/src/reminders/dto/update-reminder.dto.ts` 改為：

```typescript
import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { CreateReminderDto } from './create-reminder.dto';

export class UpdateReminderDto extends PartialType(CreateReminderDto) {
  @ApiPropertyOptional({ nullable: true, description: 'null 表示移出群組' })
  @IsOptional()
  groupId?: string | null;
}
```

- [ ] **Step 3：更新 RemindersService**

修改 `backend/src/reminders/reminders.service.ts`：

**3a. `findAll` 加入 group include：**

```typescript
findAll() {
  return this.prisma.reminder.findMany({
    include: { recurrenceRules: true, group: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
}
```

**3b. `findOne` 加入 group include：**

```typescript
async findOne(id: string) {
  const reminder = await this.prisma.reminder.findUnique({
    where: { id },
    include: { recurrenceRules: true, group: true },
  });
  if (!reminder) {
    throw new NotFoundException('提醒不存在');
  }
  return reminder;
}
```

**3c. `create` 加入 groupId 驗證與寫入：**

在 `const sortOrder = ...` 行之後、`return this.prisma.reminder.create(...)` 之前插入驗證：

```typescript
if (dto.groupId) {
  const group = await this.prisma.group.findUnique({ where: { id: dto.groupId } });
  if (!group) throw new BadRequestException('指定的群組不存在');
}
```

在 `create` 的 `data` 物件加入：

```typescript
groupId: dto.groupId ?? null,
```

`create` 呼叫也加入 `group: true` include：

```typescript
return this.prisma.reminder.create({
  include: { recurrenceRules: true, group: true },
  data: {
    // ... 原有欄位 ...
    groupId: dto.groupId ?? null,
    // ...
  },
});
```

**3d. `update` 加入 groupId 驗證與寫入：**

在 `const payload: Prisma.ReminderUpdateInput = { ... }` 的物件內、`if (dto.recurrenceRules !== undefined)` 之前，於 payload 宣告後加入：

```typescript
if (dto.groupId !== undefined) {
  if (dto.groupId) {
    const group = await this.prisma.group.findUnique({ where: { id: dto.groupId } });
    if (!group) throw new BadRequestException('指定的群組不存在');
  }
  payload.groupId = dto.groupId;
}
```

`update` 最後的 `return this.findOne(id)` 已包含 group include，不需修改。

**3e. `setEnabled` 加入 group include：**

```typescript
async setEnabled(id: string, enabled: boolean) {
  await this.findOne(id);
  return this.prisma.reminder.update({
    where: { id },
    data: { enabled },
    include: { recurrenceRules: true, group: true },
  });
}
```

- [ ] **Step 4：確認後端編譯無錯誤**

觀察 backend watch mode 的 terminal，確認無 TypeScript 錯誤。

- [ ] **Step 5：快速手動測試 groupId**

```bash
# 建立群組
curl -X POST http://localhost:3000/groups \
  -H "Content-Type: application/json" \
  -d '{"name":"測試群組"}'
# 記下回傳的 id，例如 "abc-123"

# 建立有 groupId 的 reminder
curl -X POST http://localhost:3000/reminders \
  -H "Content-Type: application/json" \
  -d '{"title":"測試","scheduleType":"one_time","oneTimeAt":"2026-12-01T10:00:00Z","groupId":"abc-123"}'

# 確認 GET /reminders 回傳的 reminder 包含 group 欄位
curl http://localhost:3000/reminders
```

預期：reminder 回傳中有 `"group": { "id": "abc-123", "name": "測試群組", ... }`

- [ ] **Step 6：Commit**

```bash
git add backend/src/reminders/
git commit -m "feat(api): reminders support groupId (create/update/list)"
```

---

## Task 4：前端 — 更新型別、State、loadAll

**Files:**
- Modify: `frontend/src/app/page.tsx`（第一段：型別與 state）

- [ ] **Step 1：更新 Reminder 型別，新增 Group 型別**

在 `page.tsx` 頂部，將原本的 `type Reminder` 替換為：

```typescript
type Group = {
  id: string;
  name: string;
  createdAt: string;
};

type Reminder = {
  id: string;
  title: string;
  content: string;
  enabled: boolean;
  scheduleType: 'one_time' | 'recurring';
  oneTimeAt: string | null;
  sortOrder: number;
  endAt: string | null;
  maxOccurrences: number | null;
  autoCloseEnabled: boolean;
  autoCloseSeconds: number;
  snoozeDefaultSeconds: number;
  groupId: string | null;
  recurrenceRules: Array<{
    id: string;
    ruleMode: 'interval' | 'daily_time' | 'weekly_day' | 'monthly_day';
    monthDay: number | null;
    weekDays: number[];
    timeOfDay: string | null;
    intervalMinutes: number | null;
    activeFrom: string | null;
    activeUntil: string | null;
  }>;
};
```

- [ ] **Step 2：移除 localStorage 相關常數**

刪除以下兩行：

```typescript
const STORAGE_KEY_GROUP_NAMES = 'remindme:groupNames';
const STORAGE_KEY_GROUP_MAP = 'remindme:reminderGroupMap';
```

- [ ] **Step 3：更新 state 宣告**

在 `export default function Home()` 內，做以下 state 替換：

**移除：**
```typescript
const [selectedGroup, setSelectedGroup] = useState<string>('');
const [groupNames, setGroupNames] = useState<string[]>([]);
const [reminderGroupMap, setReminderGroupMap] = useState<Record<string, string>>({});
const [groupsHydrated, setGroupsHydrated] = useState(false);
const [editingGroupName, setEditingGroupName] = useState<string | null>(null);
```

**加入：**
```typescript
const [groups, setGroups] = useState<Group[]>([]);
const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
```

`showCreateGroup`、`newGroupName`、`editingGroupValue` 保持不變。

- [ ] **Step 4：移除 localStorage 相關 useEffect（共三個）**

刪除以下三個 useEffect（載入 localStorage、寫入 groupNames、寫入 reminderGroupMap）：

```typescript
// 刪除這個（讀取 localStorage）
useEffect(() => {
  try {
    const rawNames = window.localStorage.getItem(STORAGE_KEY_GROUP_NAMES);
    // ...
  } finally {
    setGroupsHydrated(true);
  }
}, []);

// 刪除這個（寫入 groupNames）
useEffect(() => {
  if (!groupsHydrated) return;
  window.localStorage.setItem(STORAGE_KEY_GROUP_NAMES, JSON.stringify(groupNames));
}, [groupNames, groupsHydrated]);

// 刪除這個（寫入 reminderGroupMap）
useEffect(() => {
  if (!groupsHydrated) return;
  window.localStorage.setItem(STORAGE_KEY_GROUP_MAP, JSON.stringify(reminderGroupMap));
}, [reminderGroupMap, groupsHydrated]);
```

- [ ] **Step 5：新增 fetchGroups 函式，更新 loadAll**

在 `fetchDisplaySetting` 函式之後新增：

```typescript
async function fetchGroups() {
  try {
    const response = await fetch(`${API_BASE_URL}/groups`, { cache: 'no-store' });
    if (!response.ok) throw new Error('讀取群組失敗');
    setGroups((await response.json()) as Group[]);
  } catch {
    setMessage({ text: '無法讀取群組資料', tone: 'error' });
  }
}
```

將 `loadAll` 更新為：

```typescript
async function loadAll() {
  await Promise.all([fetchReminders(), fetchDisplaySetting(), fetchGroups()]);
}
```

- [ ] **Step 6：Commit（此時前端尚未完整可用，但型別正確）**

```bash
git add frontend/src/app/page.tsx
git commit -m "feat(frontend): add Group type, API fetch, replace localStorage state"
```

---

## Task 5：前端 — 更新群組操作函式

**Files:**
- Modify: `frontend/src/app/page.tsx`（群組 CRUD 函式）

- [ ] **Step 1：將 createGroup 改為呼叫 API**

將原本的 `createGroup` 函式替換為：

```typescript
async function createGroup() {
  const name = newGroupName.trim() || '未命名群組';
  try {
    const response = await fetch(`${API_BASE_URL}/groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (response.status === 409) {
      setMessage({ text: '此群組名已佔用，請使用其他名稱。', tone: 'error' });
      return;
    }
    if (!response.ok) throw new Error('建立群組失敗');
    const created = (await response.json()) as Group;
    setGroups((prev) => [...prev, created]);
    setSelectedGroupId(created.id);
    setShowCreateGroup(false);
    setNewGroupName('');
  } catch {
    setMessage({ text: '建立群組失敗，請確認後端狀態。', tone: 'error' });
  }
}
```

- [ ] **Step 2：將 deleteGroup 改為呼叫 API**

將原本的 `deleteGroup` 函式替換為：

```typescript
function deleteGroup(id: string, name: string) {
  const count = reminders.filter((r) => r.groupId === id).length;
  modals.openConfirmModal({
    title: `確定要刪除群組「${name}」？`,
    centered: true,
    children: (
      <Text size="sm">
        {count > 0
          ? `群組內 ${count} 則提醒不會被刪除，會自動歸入「未分組」。`
          : '此群組目前沒有提醒。'}
      </Text>
    ),
    labels: { confirm: '刪除群組', cancel: '取消' },
    confirmProps: { color: 'red' },
    onConfirm: async () => {
      await fetch(`${API_BASE_URL}/groups/${id}`, { method: 'DELETE' });
      setGroups((prev) => prev.filter((g) => g.id !== id));
      if (selectedGroupId === id) {
        setSelectedGroupId(null);
        setTaskView('list');
        setEditingId(null);
        setForm(DEFAULT_FORM);
      }
      await fetchReminders();
    },
  });
}
```

- [ ] **Step 3：將 renameGroup 改為呼叫 API**

將原本的 `renameGroup` 函式替換為：

```typescript
async function renameGroup(id: string) {
  const nextName = editingGroupValue.trim();
  if (!nextName) {
    setEditingGroupId(null);
    setEditingGroupValue('');
    return;
  }
  try {
    const response = await fetch(`${API_BASE_URL}/groups/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: nextName }),
    });
    if (response.status === 409) {
      setMessage({ text: '此群組名已佔用，請使用其他名稱。', tone: 'error' });
      return;
    }
    if (!response.ok) throw new Error('重命名失敗');
    const updated = (await response.json()) as Group;
    setGroups((prev) => prev.map((g) => (g.id === id ? updated : g)));
    setEditingGroupId(null);
    setEditingGroupValue('');
  } catch {
    setMessage({ text: '重命名群組失敗，請確認後端狀態。', tone: 'error' });
  }
}
```

- [ ] **Step 4：更新 createReminderInGroup**

將原本：

```typescript
function createReminderInGroup(groupName: string) {
  setSelectedGroup(groupName);
  setEditingId(null);
  setForm(DEFAULT_FORM);
  setTaskView('editor');
}
```

替換為：

```typescript
function createReminderInGroup(groupId: string | null) {
  setSelectedGroupId(groupId);
  setEditingId(null);
  setForm(DEFAULT_FORM);
  setTaskView('editor');
}
```

- [ ] **Step 5：更新 beginEdit**

在 `beginEdit` 函式中，將：

```typescript
const parentGroup =
  groups.find((group) => group.items.some((item) => item.id === reminder.id))?.name ??
  '未分組';
setSelectedGroup(parentGroup);
```

替換為：

```typescript
setSelectedGroupId(reminder.groupId ?? null);
```

- [ ] **Step 6：更新 cancelEdit**

將：

```typescript
function cancelEdit() {
  setEditingId(null);
  setForm(DEFAULT_FORM);
  setTaskView('list');
}
```

保持不變（`selectedGroupId` 不需要在此重置）。

- [ ] **Step 7：更新 getGroupOf（拖曳用）**

將原本：

```typescript
function getGroupOf(id: string) {
  const mapped = reminderGroupMap[id];
  if (mapped && groupNames.includes(mapped)) return mapped;
  return '未分組';
}
```

替換為：

```typescript
function getGroupOf(id: string) {
  return reminders.find((r) => r.id === id)?.groupId ?? null;
}
```

- [ ] **Step 8：更新 session storage 草稿格式**

在 session storage 寫入的 useEffect 中，將：

```typescript
JSON.stringify({ form, editingId, selectedGroup }),
```

改為：

```typescript
JSON.stringify({ form, editingId, selectedGroupId }),
```

在 session storage 讀取的 useEffect 中，將：

```typescript
setSelectedGroup(parsed.selectedGroup ?? '');
```

改為：

```typescript
setSelectedGroupId(parsed.selectedGroupId ?? null);
```

並將讀取時的 `parsed` 型別宣告更新為：

```typescript
const parsed = JSON.parse(raw) as {
  form?: FormState;
  editingId?: string | null;
  selectedGroupId?: string | null;
};
```

- [ ] **Step 9：Commit**

```bash
git add frontend/src/app/page.tsx
git commit -m "feat(frontend): group CRUD operations use API instead of localStorage"
```

---

## Task 6：前端 — 更新 useMemo、handleSubmit、渲染

**Files:**
- Modify: `frontend/src/app/page.tsx`（渲染層）

- [ ] **Step 1：新增 GroupView 型別並替換 groups useMemo**

在 `Reminder` 型別定義後方加入：

```typescript
type GroupView = {
  id: string | null;
  name: string;
  items: Reminder[];
};
```

將原本的 `groups` useMemo（依賴 `groupNames`、`reminderGroupMap`）替換為 `groupedView`：

```typescript
const groupedView = useMemo<GroupView[]>(() => {
  const result: GroupView[] = groups.map((g) => ({
    id: g.id,
    name: g.name,
    items: reminders.filter((r) => r.groupId === g.id),
  }));
  const ungrouped = reminders.filter((r) => !r.groupId);
  if (ungrouped.length > 0) {
    result.push({ id: null, name: '未分組', items: ungrouped });
  }
  return result;
}, [groups, reminders]);
```

- [ ] **Step 2：更新 buildReminderPayload，加入 groupId**

在 `buildReminderPayload` 的 one_time 與 recurring 兩個物件中，於 `skipShortMonthConfirmation` 之後加入：

```typescript
groupId: selectedGroupId,
```

兩個分支都要加。

- [ ] **Step 3：更新 handleSubmit，移除 localStorage mapping 邏輯**

在 `handleSubmit` 函式中，刪除以下整段（約 7 行）：

```typescript
if (!isEditing && selectedGroup && selectedGroup !== '未分組') {
  const created = data as Reminder;
  if (created?.id) {
    setReminderGroupMap((prev) => ({ ...prev, [created.id]: selectedGroup }));
  }
}
```

（因為 groupId 現在已包含在 API payload 中，後端直接持久化。）

- [ ] **Step 4：更新渲染區塊（JSX）**

**(a)** 將所有 `groups.map(...)` 改為 `groupedView.map(...)`：

```tsx
{groupedView.map((group) => (
  <Paper key={group.id ?? 'ungrouped'} className="surface" radius="md" p="md">
```

注意 `key` 改用 `group.id ?? 'ungrouped'`（因為 id 可能是 null）。

**(b)** 群組的「空狀態」檢查從 `groups.length === 0` 改為 `groupedView.length === 0`：

```tsx
{groupedView.length === 0 ? (
  <Paper ...>
```

**(c)** 空狀態的「立即新增提醒」按鈕：

```tsx
onClick={() => createReminderInGroup(null)}
```

**(d)** 編輯群組名稱的 `TextInput` inline 條件，從 `editingGroupName === group.name` 改為 `editingGroupId === group.id`：

```tsx
{editingGroupId === group.id ? (
  <TextInput
    ...
    onKeyDown={(event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void renameGroup(group.id!);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        setEditingGroupId(null);
        setEditingGroupValue('');
      }
    }}
  />
) : (
  <Text fw={700}>{group.name}</Text>
)}
```

**(e)** 顯示編輯/刪除按鈕的條件，從 `group.name !== '未分組'` 改為 `group.id !== null`：

```tsx
{group.id !== null ? (
  <Group gap={4} wrap="nowrap">
    {editingGroupId === group.id ? (
      <>
        <Button size="xs" variant="default" onClick={() => {
          setEditingGroupId(null);
          setEditingGroupValue('');
        }}>取消</Button>
        <Button size="xs" onClick={() => void renameGroup(group.id!)}>儲存</Button>
      </>
    ) : (
      <>
        <Tooltip label="編輯群組名稱">
          <ActionIcon variant="subtle" color="gray" onClick={() => {
            setEditingGroupId(group.id);
            setEditingGroupValue(group.name);
          }}>
            <PenLine size={14} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="刪除群組">
          <ActionIcon variant="subtle" color="red" onClick={() => deleteGroup(group.id!, group.name)}>
            <Trash2 size={14} />
          </ActionIcon>
        </Tooltip>
      </>
    )}
  </Group>
) : null}
```

**(f)** 「新增提醒」按鈕，從 `createReminderInGroup(group.name)` 改為：

```tsx
onClick={() => createReminderInGroup(group.id)}
```

**(g)** 在 `SortableReminderRow` 的 `onEdit` callback 中，從：

```tsx
onEdit={() => {
  setSelectedGroup(group.name);
  beginEdit(item);
}}
```

改為：

```tsx
onEdit={() => {
  beginEdit(item);
}}
```

（`selectedGroupId` 已在 `beginEdit` 內從 `reminder.groupId` 設定，不需要額外 set）

- [ ] **Step 5：移除未使用的 import（如果有）**

確認 `activeReminder` useMemo 的依賴還是 `reminders`（不變）。
確認 `isEditing` 的定義不變。
移除 `page.tsx` 頂部任何因移除 localStorage 而不再使用的 import（若有）。

- [ ] **Step 6：在瀏覽器測試完整流程**

1. 打開 `http://localhost:3001`
2. 點擊「新增任務群組」→ 輸入名稱 → 建立
3. 在群組內新增提醒
4. 重新整理頁面，確認群組與提醒都保留
5. 重命名群組，重整後確認名稱更新
6. 刪除群組，確認提醒移入「未分組」
7. 空白狀態點「立即新增提醒」，確認提醒出現在「未分組」

- [ ] **Step 7：Commit**

```bash
git add frontend/src/app/page.tsx
git commit -m "feat(frontend): use groupedView from API, remove all localStorage group logic"
```
