# Tauri 桌面殼層實作計劃

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 將 RemindMe 包裝成 Windows 桌面 App，提醒到期時在螢幕角落彈出無框視窗。

**Architecture:** Tauri Shell 啟動後 spawn Node.js 執行 NestJS（連接 SQLite），WebView 指向 localhost:3000。Rust 層每 30 秒呼叫 `/scheduler/due`，有到期提醒就開一個無框 popup 視窗載入 `/popup/[id]`。

**Tech Stack:** NestJS + Prisma 6 + SQLite、@nestjs/schedule、Next.js 16、Tauri 2.x（Rust）、@tauri-apps/api

---

## 檔案異動清單

### 新增
- `backend/src/scheduler/scheduler.module.ts`
- `backend/src/scheduler/scheduler.service.ts`
- `backend/src/scheduler/scheduler.controller.ts`
- `backend/src/scheduler/scheduler.service.spec.ts`
- `backend/src/reminders/dto/snooze-reminder.dto.ts`
- `frontend/src/app/popup/[id]/page.tsx`
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`
- `src-tauri/build.rs`
- `src-tauri/src/main.rs`
- `src-tauri/src/sidecar.rs`
- `src-tauri/src/scheduler.rs`
- `src-tauri/src/popup.rs`
- `src-tauri/src/tray.rs`
- `src-tauri/icons/icon.png`（32×32，任意圖示）

### 修改
- `backend/prisma/schema.prisma` — 改 provider、移除 `@db.VarChar`
- `backend/.env` — DATABASE_URL 改 SQLite
- `backend/.env.example` — 同上
- `backend/package.json` — 移除 `pg`、新增 `@nestjs/schedule`
- `backend/src/app.module.ts` — 註冊 ScheduleModule + SchedulerModule
- `backend/src/reminders/reminders.controller.ts` — 新增 snooze endpoint
- `backend/src/reminders/reminders.service.ts` — 新增 snooze 方法
- `backend/src/app.controller.ts` — 新增 `/health` endpoint
- `backend/prisma/migrations/` — 刪除舊 PG 遷移、建立新 SQLite 遷移
- `frontend/package.json` — 新增 `@tauri-apps/api`
- `.gitignore` — 新增 `backend/data/`、`src-tauri/target/`

---

## Task 1：SQLite 遷移

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Modify: `backend/.env`, `backend/.env.example`
- Modify: `backend/package.json`
- Delete: `backend/prisma/migrations/` 內所有舊遷移資料夾

- [ ] **Step 1: 移除所有 `@db.VarChar` 並改 provider**

開啟 `backend/prisma/schema.prisma`，替換 datasource block 和所有帶 `@db.VarChar` 的欄位：

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

enum ScheduleType {
  one_time
  recurring
}

enum RuleMode {
  interval
  daily_time
  weekly_day
  monthly_day
}

enum PopupSize {
  small
  medium
  large
}

enum PopupTheme {
  light
  dark
}

enum PopupCorner {
  top_left
  top_right
  bottom_left
  bottom_right
}

enum MascotMode {
  system
  custom
}

enum MascotIcon {
  bell_ring
  sparkles
  calendar_clock
}

model Group {
  id        String     @id @default(uuid())
  name      String     @unique
  createdAt DateTime   @default(now())
  reminders Reminder[]
}

model Reminder {
  id                   String           @id @default(uuid())
  title                String
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

  @@index([groupId])
}

model RecurrenceRule {
  id              String   @id @default(uuid())
  ruleMode        RuleMode
  monthDay        Int?
  weekDays        Int[]    @default([])
  timeOfDay       String?
  intervalMinutes Int?
  activeFrom      String?
  activeUntil     String?
  reminderId      String
  reminder        Reminder @relation(fields: [reminderId], references: [id], onDelete: Cascade)
}

model DisplaySetting {
  id             String        @id @default(uuid())
  size           PopupSize     @default(medium)
  theme          PopupTheme    @default(light)
  corner         PopupCorner   @default(bottom_right)
  showContent    Boolean       @default(true)
  targetScreenId String?
  mascotMode     MascotMode    @default(system)
  mascotIcon     MascotIcon    @default(bell_ring)
  mascotImages   MascotImage[]
}

model MascotImage {
  id               String         @id @default(uuid())
  filePath         String
  mimeType         String
  width            Int
  height           Int
  sizeBytes        Int
  displaySettingId String
  displaySetting   DisplaySetting @relation(fields: [displaySettingId], references: [id], onDelete: Cascade)
}
```

- [ ] **Step 2: 更新 .env 和 .env.example**

`backend/.env`（保留其他設定，只改 DATABASE_URL）：
```
DATABASE_URL="file:./data/remindme.db"
```

`backend/.env.example`：
```
DATABASE_URL="file:./data/remindme.db"
```

- [ ] **Step 3: 移除 pg、安裝 @nestjs/schedule**

```bash
cd backend
npm uninstall pg
npm install @nestjs/schedule
```

- [ ] **Step 4: 刪除舊遷移，建立 SQLite 遷移**

```bash
cd backend
# 刪除舊的 PostgreSQL 遷移（內容不相容）
Remove-Item -Recurse -Force prisma/migrations
mkdir prisma/data -ErrorAction SilentlyContinue

# 建立 SQLite 初始遷移
npx dotenv -e ../.env -- prisma migrate dev --name init-sqlite
```

預期輸出：`Generated Prisma Client` 且 `backend/data/remindme.db` 存在。

- [ ] **Step 5: 新增 .gitignore 排除**

在根目錄的 `.gitignore` 末尾加入：
```
backend/data/
src-tauri/target/
```

- [ ] **Step 6: 驗證後端可正常啟動**

```bash
cd backend
npm run start:dev
```

在新終端機測試：
```bash
curl http://localhost:3000
```
預期回傳：`Hello World!`

- [ ] **Step 7: Commit**

```bash
git add backend/prisma/schema.prisma backend/.env.example backend/package.json backend/prisma/migrations/ .gitignore
git commit -m "feat(db): migrate from postgresql to sqlite"
```

---

## Task 2：NestJS Health Endpoint

**Files:**
- Modify: `backend/src/app.controller.ts`

- [ ] **Step 1: 新增 /health endpoint**

```typescript
// backend/src/app.controller.ts
import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
  getHello(): string {
    return 'Hello World!';
  }

  @Get('health')
  health(): { status: string } {
    return { status: 'ok' };
  }
}
```

- [ ] **Step 2: 驗證**

```bash
cd backend && npm run start:dev
# 另一終端
curl http://localhost:3000/health
```
預期：`{"status":"ok"}`

- [ ] **Step 3: Commit**

```bash
git add backend/src/app.controller.ts
git commit -m "feat(api): add /health endpoint for Tauri startup check"
```

---

## Task 3：NestJS Scheduler 模組

**Files:**
- Create: `backend/src/scheduler/scheduler.service.spec.ts`
- Create: `backend/src/scheduler/scheduler.service.ts`
- Create: `backend/src/scheduler/scheduler.controller.ts`
- Create: `backend/src/scheduler/scheduler.module.ts`
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1: 先寫測試（TDD）**

建立 `backend/src/scheduler/scheduler.service.spec.ts`：

```typescript
import { SchedulerService } from './scheduler.service';

type RecurrenceRule = {
  ruleMode: string;
  monthDay?: number | null;
  weekDays: number[];
  timeOfDay?: string | null;
  intervalMinutes?: number | null;
  activeFrom?: string | null;
  activeUntil?: string | null;
};

function makeReminder(overrides: Partial<{
  enabled: boolean;
  scheduleType: string;
  oneTimeAt: Date | null;
  endAt: Date | null;
  maxOccurrences: number | null;
  recurrenceRules: RecurrenceRule[];
}> = {}) {
  return {
    id: 'test-id',
    enabled: true,
    scheduleType: 'recurring',
    oneTimeAt: null,
    endAt: null,
    maxOccurrences: null,
    recurrenceRules: [],
    ...overrides,
  };
}

describe('SchedulerService.isReminderDue', () => {
  const svc = new SchedulerService(null as any, null as any);

  describe('one_time', () => {
    it('triggers when oneTimeAt is within past 30s', () => {
      const now = new Date('2026-05-20T10:00:15Z');
      const reminder = makeReminder({
        scheduleType: 'one_time',
        oneTimeAt: new Date('2026-05-20T10:00:00Z'),
      });
      expect(svc.isReminderDue(reminder as any, now)).toBe(true);
    });

    it('does not trigger if oneTimeAt is in the future', () => {
      const now = new Date('2026-05-20T10:00:00Z');
      const reminder = makeReminder({
        scheduleType: 'one_time',
        oneTimeAt: new Date('2026-05-20T10:01:00Z'),
      });
      expect(svc.isReminderDue(reminder as any, now)).toBe(false);
    });

    it('does not trigger if oneTimeAt was > 30s ago', () => {
      const now = new Date('2026-05-20T10:01:00Z');
      const reminder = makeReminder({
        scheduleType: 'one_time',
        oneTimeAt: new Date('2026-05-20T10:00:00Z'),
      });
      expect(svc.isReminderDue(reminder as any, now)).toBe(false);
    });
  });

  describe('daily_time', () => {
    it('triggers at the correct time today', () => {
      const now = new Date('2026-05-20T10:00:10Z');
      const reminder = makeReminder({
        recurrenceRules: [{ ruleMode: 'daily_time', timeOfDay: '10:00', weekDays: [] }],
      });
      expect(svc.isReminderDue(reminder as any, now)).toBe(true);
    });

    it('does not trigger 31s after the time', () => {
      const now = new Date('2026-05-20T10:00:31Z');
      const reminder = makeReminder({
        recurrenceRules: [{ ruleMode: 'daily_time', timeOfDay: '10:00', weekDays: [] }],
      });
      expect(svc.isReminderDue(reminder as any, now)).toBe(false);
    });
  });

  describe('weekly_day', () => {
    it('triggers on matching weekday and time', () => {
      // 2026-05-20 is a Wednesday = weekDay 3
      const now = new Date('2026-05-20T14:30:05Z');
      const reminder = makeReminder({
        recurrenceRules: [{ ruleMode: 'weekly_day', weekDays: [3], timeOfDay: '14:30' }],
      });
      expect(svc.isReminderDue(reminder as any, now)).toBe(true);
    });

    it('does not trigger on wrong weekday', () => {
      const now = new Date('2026-05-20T14:30:05Z'); // Wednesday
      const reminder = makeReminder({
        recurrenceRules: [{ ruleMode: 'weekly_day', weekDays: [1], timeOfDay: '14:30' }],
      });
      expect(svc.isReminderDue(reminder as any, now)).toBe(false);
    });
  });

  describe('monthly_day', () => {
    it('triggers on matching day of month and time', () => {
      const now = new Date('2026-05-20T09:00:05Z');
      const reminder = makeReminder({
        recurrenceRules: [{ ruleMode: 'monthly_day', monthDay: 20, timeOfDay: '09:00', weekDays: [] }],
      });
      expect(svc.isReminderDue(reminder as any, now)).toBe(true);
    });

    it('does not trigger on wrong day of month', () => {
      const now = new Date('2026-05-20T09:00:05Z');
      const reminder = makeReminder({
        recurrenceRules: [{ ruleMode: 'monthly_day', monthDay: 15, timeOfDay: '09:00', weekDays: [] }],
      });
      expect(svc.isReminderDue(reminder as any, now)).toBe(false);
    });
  });

  describe('interval', () => {
    it('triggers when minutes align with interval and within 30s', () => {
      // 10:00:10 — minutesSinceMidnight=600, 600 % 30 === 0, seconds=10 ≤ 30
      const now = new Date('2026-05-20T10:00:10Z');
      const reminder = makeReminder({
        recurrenceRules: [{ ruleMode: 'interval', intervalMinutes: 30, weekDays: [] }],
      });
      expect(svc.isReminderDue(reminder as any, now)).toBe(true);
    });

    it('does not trigger mid-interval', () => {
      // 10:15:05 — 615 % 30 = 15 ≠ 0
      const now = new Date('2026-05-20T10:15:05Z');
      const reminder = makeReminder({
        recurrenceRules: [{ ruleMode: 'interval', intervalMinutes: 30, weekDays: [] }],
      });
      expect(svc.isReminderDue(reminder as any, now)).toBe(false);
    });

    it('respects activeFrom/activeUntil window', () => {
      // 08:00:05 — outside 09:00~17:00
      const now = new Date('2026-05-20T08:00:05Z');
      const reminder = makeReminder({
        recurrenceRules: [{
          ruleMode: 'interval', intervalMinutes: 60, weekDays: [],
          activeFrom: '09:00', activeUntil: '17:00',
        }],
      });
      expect(svc.isReminderDue(reminder as any, now)).toBe(false);
    });
  });

  describe('endAt / enabled', () => {
    it('does not trigger if disabled', () => {
      const now = new Date('2026-05-20T10:00:10Z');
      const reminder = makeReminder({
        enabled: false,
        scheduleType: 'one_time',
        oneTimeAt: new Date('2026-05-20T10:00:00Z'),
      });
      expect(svc.isReminderDue(reminder as any, now)).toBe(false);
    });

    it('does not trigger if past endAt', () => {
      const now = new Date('2026-05-20T10:00:10Z');
      const reminder = makeReminder({
        scheduleType: 'one_time',
        oneTimeAt: new Date('2026-05-20T10:00:00Z'),
        endAt: new Date('2026-05-19T00:00:00Z'),
      });
      expect(svc.isReminderDue(reminder as any, now)).toBe(false);
    });
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

```bash
cd backend && npx jest scheduler.service.spec --no-coverage
```
預期：`FAIL` 因為 `SchedulerService` 還不存在。

- [ ] **Step 3: 實作 SchedulerService**

建立 `backend/src/scheduler/scheduler.service.ts`：

```typescript
import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Reminder, RecurrenceRule } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DisplaySettingsService } from '../display-settings/display-settings.service';

type ReminderWithRules = Reminder & { recurrenceRules: RecurrenceRule[] };

export interface DueReminderDto {
  id: string;
  title: string;
  content: string;
  autoCloseEnabled: boolean;
  autoCloseSeconds: number;
  snoozeDefaultSeconds: number;
  corner: string;
  size: string;
}

@Injectable()
export class SchedulerService {
  private readonly firedSet = new Set<string>();
  private readonly fireCountMap = new Map<string, number>();
  private readonly snoozeUntilMap = new Map<string, number>();
  private pendingQueue: DueReminderDto[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly displaySettings: DisplaySettingsService,
  ) {}

  @Cron('*/30 * * * * *')
  async checkDue() {
    const now = new Date();
    const reminders = await this.prisma.reminder.findMany({
      where: { enabled: true },
      include: { recurrenceRules: true },
    });

    const displaySetting = await this.displaySettings.getCurrent();
    const dueReminders: DueReminderDto[] = [];

    for (const reminder of reminders) {
      if (!this.isReminderDue(reminder, now)) continue;

      const windowKey = this.getWindowKey(reminder, now);
      const firedKey = `${reminder.id}-${windowKey}`;
      if (this.firedSet.has(firedKey)) continue;

      const snoozeUntil = this.snoozeUntilMap.get(reminder.id);
      if (snoozeUntil && now.getTime() < snoozeUntil) continue;

      if (reminder.maxOccurrences !== null) {
        const count = this.fireCountMap.get(reminder.id) ?? 0;
        if (count >= reminder.maxOccurrences) continue;
        this.fireCountMap.set(reminder.id, count + 1);
      }

      this.firedSet.add(firedKey);
      dueReminders.push({
        id: reminder.id,
        title: reminder.title,
        content: reminder.content,
        autoCloseEnabled: reminder.autoCloseEnabled,
        autoCloseSeconds: reminder.autoCloseSeconds,
        snoozeDefaultSeconds: reminder.snoozeDefaultSeconds,
        corner: displaySetting.corner,
        size: displaySetting.size,
      });
    }

    this.pendingQueue.push(...dueReminders);
  }

  consumeDue(): DueReminderDto[] {
    const items = [...this.pendingQueue];
    this.pendingQueue = [];
    return items;
  }

  snoozeReminder(id: string, seconds: number) {
    this.snoozeUntilMap.set(id, Date.now() + seconds * 1000);
  }

  isReminderDue(reminder: ReminderWithRules, now: Date): boolean {
    if (!reminder.enabled) return false;
    if (reminder.endAt && now > reminder.endAt) return false;

    if (reminder.scheduleType === 'one_time') {
      if (!reminder.oneTimeAt) return false;
      const diff = now.getTime() - reminder.oneTimeAt.getTime();
      return diff >= 0 && diff <= 30000;
    }

    return reminder.recurrenceRules.some((rule) => this.isRuleDue(rule, now));
  }

  private isRuleDue(rule: RecurrenceRule, now: Date): boolean {
    const withinWindow = (h: number, m: number): boolean => {
      const target = new Date(now);
      target.setHours(h, m, 0, 0);
      const diff = now.getTime() - target.getTime();
      return diff >= 0 && diff <= 30000;
    };

    switch (rule.ruleMode) {
      case 'daily_time': {
        if (!rule.timeOfDay) return false;
        const [h, m] = rule.timeOfDay.split(':').map(Number);
        return withinWindow(h, m);
      }
      case 'weekly_day': {
        if (!rule.timeOfDay || !rule.weekDays?.length) return false;
        if (!rule.weekDays.includes(now.getDay())) return false;
        const [h, m] = rule.timeOfDay.split(':').map(Number);
        return withinWindow(h, m);
      }
      case 'monthly_day': {
        if (!rule.timeOfDay || !rule.monthDay) return false;
        if (now.getDate() !== rule.monthDay) return false;
        const [h, m] = rule.timeOfDay.split(':').map(Number);
        return withinWindow(h, m);
      }
      case 'interval': {
        if (!rule.intervalMinutes) return false;
        if (rule.activeFrom && rule.activeUntil) {
          const [fh, fm] = rule.activeFrom.split(':').map(Number);
          const [uh, um] = rule.activeUntil.split(':').map(Number);
          const nowMin = now.getHours() * 60 + now.getMinutes();
          if (nowMin < fh * 60 + fm || nowMin > uh * 60 + um) return false;
        }
        if (rule.weekDays?.length) {
          if (!rule.weekDays.includes(now.getDay())) return false;
        }
        const minutesSinceMidnight = now.getHours() * 60 + now.getMinutes();
        return minutesSinceMidnight % rule.intervalMinutes === 0 && now.getSeconds() <= 30;
      }
      default:
        return false;
    }
  }

  private getWindowKey(reminder: ReminderWithRules, now: Date): string {
    if (reminder.scheduleType === 'one_time') return 'one_time';
    const pad = (n: number) => String(n).padStart(2, '0');
    const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    return `${dateStr}-${timeStr}`;
  }
}
```

- [ ] **Step 4: 執行測試確認通過**

```bash
cd backend && npx jest scheduler.service.spec --no-coverage
```
預期：所有測試 `PASS`。

- [ ] **Step 5: 建立 SchedulerController**

建立 `backend/src/scheduler/scheduler.controller.ts`：

```typescript
import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SchedulerService } from './scheduler.service';

@ApiTags('scheduler')
@Controller('scheduler')
export class SchedulerController {
  constructor(private readonly schedulerService: SchedulerService) {}

  @Get('due')
  @ApiOperation({ summary: '取得並清空待觸發提醒佇列（供 Tauri 輪詢）' })
  getDue() {
    return this.schedulerService.consumeDue();
  }
}
```

- [ ] **Step 6: 建立 SchedulerModule**

建立 `backend/src/scheduler/scheduler.module.ts`：

```typescript
import { Module } from '@nestjs/common';
import { DisplaySettingsModule } from '../display-settings/display-settings.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SchedulerController } from './scheduler.controller';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [PrismaModule, DisplaySettingsModule],
  controllers: [SchedulerController],
  providers: [SchedulerService],
  exports: [SchedulerService],
})
export class SchedulerModule {}
```

- [ ] **Step 7: 確認 DisplaySettingsModule 有 export DisplaySettingsService**

開啟 `backend/src/display-settings/display-settings.module.ts`，確認有 `exports: [DisplaySettingsService]`。若無則加上：

```typescript
@Module({
  imports: [PrismaModule],
  controllers: [DisplaySettingsController],
  providers: [DisplaySettingsService],
  exports: [DisplaySettingsService],
})
export class DisplaySettingsModule {}
```

- [ ] **Step 8: 在 AppModule 註冊**

修改 `backend/src/app.module.ts`：

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DisplaySettingsModule } from './display-settings/display-settings.module';
import { GroupsModule } from './groups/groups.module';
import { PrismaModule } from './prisma/prisma.module';
import { RemindersModule } from './reminders/reminders.module';
import { SchedulerModule } from './scheduler/scheduler.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../.env', '.env'] }),
    ScheduleModule.forRoot(),
    PrismaModule,
    RemindersModule,
    DisplaySettingsModule,
    GroupsModule,
    SchedulerModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

- [ ] **Step 9: 驗證排程器運作**

```bash
cd backend && npm run start:dev
# 等待 30 秒後（或手動建立一個 oneTimeAt 為當前時間的提醒）
curl http://localhost:3000/scheduler/due
```
預期：`[]`（或有到期提醒的 JSON 陣列）

- [ ] **Step 10: Commit**

```bash
git add backend/src/scheduler/ backend/src/app.module.ts backend/src/display-settings/display-settings.module.ts
git commit -m "feat(api): add SchedulerModule with 30s cron and /scheduler/due endpoint"
```

---

## Task 4：Snooze API

**Files:**
- Create: `backend/src/reminders/dto/snooze-reminder.dto.ts`
- Modify: `backend/src/reminders/reminders.controller.ts`
- Modify: `backend/src/reminders/reminders.service.ts`
- Modify: `backend/src/scheduler/scheduler.module.ts`（export SchedulerService 供 RemindersModule 使用）

- [ ] **Step 1: 建立 SnoozeReminderDto**

建立 `backend/src/reminders/dto/snooze-reminder.dto.ts`：

```typescript
import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class SnoozeReminderDto {
  @ApiProperty({ description: '延後秒數', minimum: 1 })
  @IsInt()
  @Min(1)
  seconds: number;
}
```

- [ ] **Step 2: 在 RemindersModule 引入 SchedulerModule**

修改 `backend/src/reminders/reminders.module.ts`，確保 SchedulerModule 被引入：

```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { RemindersController } from './reminders.controller';
import { RemindersService } from './reminders.service';

@Module({
  imports: [PrismaModule, SchedulerModule],
  controllers: [RemindersController],
  providers: [RemindersService],
})
export class RemindersModule {}
```

- [ ] **Step 3: 在 RemindersService 新增 snooze 方法**

在 `backend/src/reminders/reminders.service.ts` 的 constructor 加入 `SchedulerService`，並新增 `snooze` 方法：

```typescript
// 在 import 區加入：
import { SchedulerService } from '../scheduler/scheduler.service';

// constructor 改為：
constructor(
  private readonly prisma: PrismaService,
  private readonly schedulerService: SchedulerService,
) {}

// 在 reorder() 後新增：
async snooze(id: string, seconds: number) {
  const reminder = await this.findOne(id);

  if (reminder.scheduleType === 'one_time') {
    const newOneTimeAt = new Date(Date.now() + seconds * 1000);
    await this.prisma.reminder.update({
      where: { id },
      data: { oneTimeAt: newOneTimeAt },
    });
  } else {
    this.schedulerService.snoozeReminder(id, seconds);
  }

  return { success: true };
}
```

- [ ] **Step 4: 在 RemindersController 新增 snooze endpoint**

在 `backend/src/reminders/reminders.controller.ts` 加入：

```typescript
// import 區加入：
import { SnoozeReminderDto } from './dto/snooze-reminder.dto';

// 在 reorder() 後加入：
@Patch(':id/snooze')
@ApiOperation({ summary: '延後提醒（Popup 用）' })
snooze(@Param('id') id: string, @Body() dto: SnoozeReminderDto) {
  return this.remindersService.snooze(id, dto.seconds);
}
```

- [ ] **Step 5: 驗證 snooze endpoint**

```bash
cd backend && npm run start:dev
# 先建立一個 one_time 提醒，拿到其 id，再測試：
curl -X PATCH http://localhost:3000/reminders/<id>/snooze \
  -H "Content-Type: application/json" \
  -d '{"seconds": 300}'
```
預期：`{"success":true}`

- [ ] **Step 6: Commit**

```bash
git add backend/src/reminders/
git commit -m "feat(api): add PATCH /reminders/:id/snooze endpoint"
```

---

## Task 5：Next.js Popup 頁面

**Files:**
- Create: `frontend/src/app/popup/[id]/page.tsx`
- Modify: `frontend/package.json`（新增 @tauri-apps/api）

- [ ] **Step 1: 安裝 @tauri-apps/api**

```bash
cd frontend
npm install @tauri-apps/api
```

- [ ] **Step 2: 建立 popup 頁面**

建立 `frontend/src/app/popup/[id]/page.tsx`：

```tsx
'use client';

import { useEffect, useState, useRef } from 'react';
import { Box, Text, Button, Group, Progress, Stack } from '@mantine/core';
import { BellRing, Sparkles, CalendarClock, X, Clock } from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';

type Reminder = {
  id: string;
  title: string;
  content: string;
  autoCloseEnabled: boolean;
  autoCloseSeconds: number;
  snoozeDefaultSeconds: number;
};

type DisplaySetting = {
  size: 'small' | 'medium' | 'large';
  showContent: boolean;
  mascotIcon: 'bell_ring' | 'sparkles' | 'calendar_clock';
};

const sizeMap = { small: 108, medium: 144, large: 182 };

const MascotIcon = ({ icon, size }: { icon: string; size: number }) => {
  const props = { size, strokeWidth: 1.5 };
  if (icon === 'sparkles') return <Sparkles {...props} />;
  if (icon === 'calendar_clock') return <CalendarClock {...props} />;
  return <BellRing {...props} />;
};

async function closeWindow() {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().close();
  } catch {
    window.close();
  }
}

export default function PopupPage({ params }: { params: { id: string } }) {
  const [reminder, setReminder] = useState<Reminder | null>(null);
  const [display, setDisplay] = useState<DisplaySetting | null>(null);
  const [progress, setProgress] = useState(100);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(`${API}/reminders/${params.id}`).then((r) => r.json()),
      fetch(`${API}/display-settings/current`).then((r) => r.json()),
    ]).then(([r, d]) => {
      setReminder(r);
      setDisplay(d);
    });
  }, [params.id]);

  useEffect(() => {
    if (!reminder?.autoCloseEnabled) return;
    const total = reminder.autoCloseSeconds * 1000;
    const start = Date.now();
    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - start;
      const pct = Math.max(0, 100 - (elapsed / total) * 100);
      setProgress(pct);
      if (elapsed >= total) {
        clearInterval(timerRef.current!);
        closeWindow();
      }
    }, 200);
    return () => clearInterval(timerRef.current!);
  }, [reminder]);

  const handleSnooze = async () => {
    if (!reminder) return;
    await fetch(`${API}/reminders/${reminder.id}/snooze`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seconds: reminder.snoozeDefaultSeconds }),
    });
    await closeWindow();
  };

  if (!reminder || !display) return null;

  const iconSize = sizeMap[display.size] * 0.4;

  return (
    <Box
      style={{
        width: '100vw',
        height: '100vh',
        background: 'rgba(238, 242, 255, 0.85)',
        backdropFilter: 'blur(40px)',
        border: '1px solid rgba(199, 210, 254, 0.6)',
        borderRadius: 16,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        userSelect: 'none',
        cursor: 'default',
      }}
    >
      <Group justify="space-between" align="flex-start">
        <MascotIcon icon={display.mascotIcon} size={iconSize} />
        <Button
          variant="subtle"
          size="compact-xs"
          color="gray"
          onClick={closeWindow}
          style={{ padding: 4 }}
        >
          <X size={14} />
        </Button>
      </Group>

      <Stack gap={4} style={{ flex: 1 }}>
        <Text fw={600} size="sm" lineClamp={2}>
          {reminder.title}
        </Text>
        {display.showContent && reminder.content && (
          <Text size="xs" c="dimmed" lineClamp={3}>
            {reminder.content}
          </Text>
        )}
      </Stack>

      {reminder.autoCloseEnabled && (
        <Progress value={progress} size="xs" color="indigo" />
      )}

      <Group gap={8} justify="flex-end">
        <Button
          variant="light"
          size="compact-sm"
          color="indigo"
          leftSection={<Clock size={12} />}
          onClick={handleSnooze}
        >
          延後 {Math.round(reminder.snoozeDefaultSeconds / 60)} 分
        </Button>
        <Button
          variant="filled"
          size="compact-sm"
          color="indigo"
          onClick={closeWindow}
        >
          關閉
        </Button>
      </Group>
    </Box>
  );
}
```

- [ ] **Step 3: 在 Next.js 設定中確認 API URL 可連後端**

確認 `frontend/.env.local`（如不存在則建立）：
```
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000
```

- [ ] **Step 4: 驗證頁面**

```bash
cd frontend && npm run dev
# 在瀏覽器開啟 http://localhost:3001/popup/<任意有效reminder-id>
```
預期：顯示吉祥物圖示、標題、延後/關閉按鈕。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/popup/ frontend/package.json frontend/.env.local
git commit -m "feat(frontend): add /popup/[id] page for Tauri popup window"
```

---

## Task 6：安裝 Rust 工具鏈與初始化 Tauri

**Files:**
- Create: `src-tauri/` （整個目錄）

> **前置條件**：需要安裝以下工具（若尚未安裝）：
> - Rust：到 https://rustup.rs 下載 `rustup-init.exe` 安裝
> - Visual C++ Build Tools：執行 `winget install Microsoft.VisualStudio.2022.BuildTools`
> - WebView2：Windows 11 預裝，通常不需額外安裝

- [ ] **Step 1: 確認 Rust 已安裝**

```bash
rustc --version
cargo --version
```
預期：顯示版本號。若未安裝，先執行 `rustup-init.exe`。

- [ ] **Step 2: 在根目錄初始化 Tauri 2.x 專案**

```bash
cd C:\Users\jiaxinli\Desktop\RemindMe
npm install -g @tauri-apps/cli@latest
tauri init
```

互動提示填入：
- App name: `RemindMe`
- Window title: `RemindMe`
- Where are your web assets: `../frontend/out`（先填這個，之後會改）
- Dev server URL: `http://localhost:3001`
- Frontend dev command: （留空，我們手動啟）
- Frontend build command: （留空）

這會在根目錄建立 `src-tauri/`。

- [ ] **Step 3: 確認 src-tauri 結構正確**

```bash
ls src-tauri/
```
預期：`Cargo.toml`, `tauri.conf.json`, `build.rs`, `src/main.rs`, `icons/`

- [ ] **Step 4: 加入 App 圖示**

在 `src-tauri/icons/` 中確保有圖示。`tauri init` 會產生預設圖示，直接使用即可。

- [ ] **Step 5: 初次 cargo build 確認可編譯**

```bash
cd src-tauri
cargo build
```
預期：成功編譯（首次需幾分鐘下載依賴）。

---

## Task 7：Tauri Cargo.toml 與 tauri.conf.json 配置

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1: 更新 Cargo.toml**

將 `src-tauri/Cargo.toml` 的 `[dependencies]` 改為：

```toml
[package]
name = "remindme"
version = "0.1.0"
edition = "2021"

[lib]
name = "remindme_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = ["tray-icon"] }
tauri-plugin-shell = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
reqwest = { version = "0.12", default-features = false, features = ["blocking", "json"] }
```

- [ ] **Step 2: 更新 tauri.conf.json**

將 `src-tauri/tauri.conf.json` 替換為：

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "RemindMe",
  "version": "0.1.0",
  "identifier": "com.funtime.remindme",
  "build": {
    "beforeDevCommand": "",
    "beforeBuildCommand": "",
    "devUrl": "http://localhost:3001",
    "frontendDist": "../frontend/out"
  },
  "app": {
    "windows": [
      {
        "label": "main",
        "title": "RemindMe",
        "width": 1200,
        "height": 800,
        "visible": false,
        "decorations": true,
        "resizable": true,
        "center": true
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.ico"
    ]
  },
  "plugins": {
    "shell": {
      "open": true
    }
  }
}
```

- [ ] **Step 3: 在根 package.json 或直接確認 tauri-plugin-shell 初始化**

在 `src-tauri/src/main.rs` 確認有 `tauri_plugin_shell::init()`（下一個 Task 會設定完整的 main.rs）。

- [ ] **Step 4: cargo build 確認可編譯**

```bash
cd src-tauri && cargo build
```
預期：成功編譯。

---

## Task 8：Tauri Rust 實作 - Sidecar（NestJS 子程序）

**Files:**
- Create: `src-tauri/src/sidecar.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: 建立 sidecar.rs**

建立 `src-tauri/src/sidecar.rs`：

```rust
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub struct NestjsSidecar {
    child: Arc<Mutex<Option<Child>>>,
}

impl NestjsSidecar {
    pub fn spawn(backend_dir: PathBuf, db_path: String) -> Result<Self, String> {
        let main_js = backend_dir.join("dist").join("main.js");
        if !main_js.exists() {
            return Err(format!(
                "找不到 {}\n請先執行 cd backend && npm run build",
                main_js.display()
            ));
        }

        let child = Command::new("node")
            .arg(&main_js)
            .env("DATABASE_URL", format!("file:{}", db_path))
            .env("PORT", "3000")
            .env("NODE_ENV", "production")
            .spawn()
            .map_err(|e| format!("無法啟動 Node.js: {e}"))?;

        Ok(Self {
            child: Arc::new(Mutex::new(Some(child))),
        })
    }

    pub fn wait_until_ready(&self) -> bool {
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(2))
            .build()
            .unwrap();

        for _ in 0..30 {
            if client
                .get("http://localhost:3000/health")
                .send()
                .map(|r| r.status().is_success())
                .unwrap_or(false)
            {
                return true;
            }
            std::thread::sleep(Duration::from_secs(1));
        }
        false
    }

    pub fn kill(&self) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
            }
        }
    }
}
```

- [ ] **Step 2: 確認 reqwest blocking feature 在 Cargo.toml 已設定**

確認 `Cargo.toml` 有：
```toml
reqwest = { version = "0.12", default-features = false, features = ["blocking", "json"] }
```

- [ ] **Step 3: cargo build 確認編譯**

```bash
cd src-tauri && cargo build 2>&1 | tail -5
```
預期：無錯誤。

---

## Task 9：Tauri Rust 實作 - Popup 視窗

**Files:**
- Create: `src-tauri/src/popup.rs`

- [ ] **Step 1: 建立 popup.rs**

建立 `src-tauri/src/popup.rs`：

```rust
use serde::Deserialize;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

#[derive(Deserialize, Debug, Clone)]
pub struct DueReminder {
    pub id: String,
    pub title: String,
    pub content: String,
    #[serde(rename = "autoCloseEnabled")]
    pub auto_close_enabled: bool,
    #[serde(rename = "autoCloseSeconds")]
    pub auto_close_seconds: i64,
    #[serde(rename = "snoozeDefaultSeconds")]
    pub snooze_default_seconds: i64,
    pub corner: String,
    pub size: String,
}

pub fn open_popup(app: &AppHandle, reminder: &DueReminder) -> Result<(), tauri::Error> {
    let label = format!("popup-{}", &reminder.id[..8]);

    // 若視窗已存在則跳過
    if app.get_webview_window(&label).is_some() {
        return Ok(());
    }

    let (width, height): (f64, f64) = match reminder.size.as_str() {
        "small" => (280.0, 140.0),
        "large" => (360.0, 200.0),
        _ => (320.0, 170.0),
    };

    let monitor = app
        .primary_monitor()
        .ok()
        .flatten()
        .expect("No monitor found");
    let screen_w = monitor.size().width as f64 / monitor.scale_factor();
    let screen_h = monitor.size().height as f64 / monitor.scale_factor();
    let margin = 16.0;

    let (x, y) = match reminder.corner.as_str() {
        "top_left" => (margin, margin),
        "top_right" => (screen_w - width - margin, margin),
        "bottom_left" => (margin, screen_h - height - margin),
        _ => (screen_w - width - margin, screen_h - height - margin),
    };

    // dev 模式連 Next.js dev server（3001），production 連 NestJS serve 的靜態檔（3000）
    let port = if cfg!(debug_assertions) { 3001 } else { 3000 };
    let url = format!("http://localhost:{}/popup/{}", port, reminder.id);

    WebviewWindowBuilder::new(app, label, WebviewUrl::External(url.parse().unwrap()))
        .title("")
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .inner_size(width, height)
        .position(x, y)
        .transparent(true)
        .visible(true)
        .build()?;

    Ok(())
}
```

- [ ] **Step 2: cargo build 確認編譯**

```bash
cd src-tauri && cargo build 2>&1 | tail -5
```

---

## Task 10：Tauri Rust 實作 - 30 秒輪詢

**Files:**
- Create: `src-tauri/src/scheduler.rs`

- [ ] **Step 1: 建立 scheduler.rs**

建立 `src-tauri/src/scheduler.rs`：

```rust
use crate::popup::{open_popup, DueReminder};
use std::time::Duration;
use tauri::AppHandle;

pub fn start_polling(app: AppHandle) {
    std::thread::spawn(move || {
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap();

        loop {
            std::thread::sleep(Duration::from_secs(30));

            match client
                .get("http://localhost:3000/scheduler/due")
                .send()
                .and_then(|r| r.json::<Vec<DueReminder>>())
            {
                Ok(reminders) => {
                    for reminder in &reminders {
                        if let Err(e) = open_popup(&app, reminder) {
                            eprintln!("開 popup 失敗: {e}");
                        }
                    }
                }
                Err(e) => eprintln!("輪詢 /scheduler/due 失敗: {e}"),
            }
        }
    });
}
```

---

## Task 11：Tauri Rust 實作 - 系統匣

**Files:**
- Create: `src-tauri/src/tray.rs`

- [ ] **Step 1: 建立 tray.rs**

建立 `src-tauri/src/tray.rs`：

```rust
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

pub fn setup_tray(app: &AppHandle) -> Result<(), tauri::Error> {
    let show = MenuItem::with_id(app, "show", "顯示主視窗", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}
```

---

## Task 12：Tauri main.rs 整合

**Files:**
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: 確認 backend 已 build**

```bash
cd backend && npm run build
```
預期：`dist/main.js` 存在。

- [ ] **Step 2: 撰寫 main.rs**

將 `src-tauri/src/main.rs` 完整替換為：

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod popup;
mod scheduler;
mod sidecar;
mod tray;

use std::path::PathBuf;
use tauri::{Manager, WindowEvent};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let app_handle = app.handle().clone();

            // 計算路徑
            let exe_dir = std::env::current_exe()
                .map(|p| p.parent().unwrap().to_path_buf())
                .unwrap_or_else(|_| PathBuf::from("."));

            // dev 模式下，exe 在 src-tauri/target/debug，backend 在 ../../backend
            let backend_dir = if cfg!(debug_assertions) {
                exe_dir.join("..").join("..").join("..").join("backend")
            } else {
                exe_dir.join("backend")
            };

            let db_path = if cfg!(debug_assertions) {
                backend_dir.join("data").join("remindme.db")
                    .to_string_lossy()
                    .to_string()
            } else {
                let data_dir = app_handle
                    .path()
                    .app_data_dir()
                    .expect("no app data dir");
                std::fs::create_dir_all(&data_dir).ok();
                data_dir.join("remindme.db").to_string_lossy().to_string()
            };

            // Spawn NestJS
            let sidecar = sidecar::NestjsSidecar::spawn(backend_dir, db_path)
                .map_err(|e| {
                    eprintln!("NestJS 啟動失敗: {e}");
                    tauri::Error::AssetNotFound(e)
                })?;

            // 等待後端健康
            eprint!("等待後端啟動");
            if !sidecar.wait_until_ready() {
                eprintln!("\n後端未能在 30 秒內就緒");
                return Err(tauri::Error::AssetNotFound("backend timeout".into()));
            }
            eprintln!(" ✓");

            // 顯示主視窗
            if let Some(w) = app_handle.get_webview_window("main") {
                w.show()?;
                w.set_focus()?;
            }

            // 系統匣
            tray::setup_tray(&app_handle)?;

            // 儲存 sidecar 讓 app 退出時可以 kill
            app_handle.manage(std::sync::Mutex::new(sidecar));

            // 啟動 30 秒輪詢
            scheduler::start_polling(app_handle);

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    window.hide().unwrap();
                    api.prevent_close();
                }
            }
        })
        .on_exit(|app| {
            if let Some(sidecar) = app.try_state::<std::sync::Mutex<sidecar::NestjsSidecar>>() {
                sidecar.lock().unwrap().kill();
            }
        })
        .run(tauri::generate_context!())
        .expect("RemindMe 啟動失敗");
}
```

- [ ] **Step 3: 確認 on_exit 型別（Tauri 2.x 差異）**

若 `on_exit` 不存在於你的 Tauri 2.x 版本，改用 `RunEvent::Exit` 處理：

```rust
// 替換 .on_exit(...) 為：
.build(tauri::generate_context!())
.expect("error building app")
.run(|app, event| {
    if let tauri::RunEvent::Exit = event {
        if let Some(sidecar) = app.try_state::<std::sync::Mutex<sidecar::NestjsSidecar>>() {
            sidecar.lock().unwrap().kill();
        }
    }
});
```

- [ ] **Step 4: cargo build 確認整體可編譯**

```bash
cd src-tauri && cargo build 2>&1 | tail -20
```
預期：成功（可能有 warning，沒有 error）。

- [ ] **Step 5: Commit**

```bash
git add src-tauri/
git commit -m "feat(tauri): add Tauri shell with NestJS sidecar, tray, and popup polling"
```

---

## Task 13：開發模式端對端驗證

- [ ] **Step 1: 啟動後端**

```bash
# Terminal A
cd backend && npm run start:dev
```
確認：`http://localhost:3000/health` 回傳 `{"status":"ok"}`

- [ ] **Step 2: 啟動前端**

```bash
# Terminal B
cd frontend && npm run dev
```
確認：`http://localhost:3001` 正常顯示

- [ ] **Step 3: 啟動 Tauri dev**

```bash
# Terminal C
cd src-tauri && cargo tauri dev
```
或：
```bash
tauri dev
```
預期：Tauri 視窗開啟，WebView 顯示 RemindMe 主畫面。

- [ ] **Step 4: 測試 Popup 觸發**

在主畫面建立一個 `one_time` 提醒，`oneTimeAt` 設為 **30 秒後**。等待 30~60 秒，應在螢幕角落看到無框彈窗。

- [ ] **Step 5: 測試延後與關閉**

點擊彈窗的「延後」按鈕 → 視窗應關閉，且對應時間後再次彈出。  
點擊「關閉」→ 視窗關閉，不再彈出。

- [ ] **Step 6: 測試系統匣**

關閉主視窗 → 應最小化到系統匣（右下角）。  
點擊匣圖示 → 主視窗重新顯示。  
右鍵匣圖示 → 選「退出」→ App 完全關閉。

- [ ] **Step 7: Final Commit**

```bash
git add .
git commit -m "feat: complete Tauri desktop shell MVP (SQLite + scheduler + popup + tray)"
```
