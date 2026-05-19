# 吉祥物圖示選擇器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 DisplayPanel 新增 3 個預設 Lucide icon 的吉祥物選擇器，並同步顯示在 MonitorMockup 即時預覽中。

**Architecture:** 後端新增 `MascotIcon` enum 與 `DisplaySetting.mascotIcon` 欄位（Prisma migration），前端更新 `DisplaySetting` 型別、在 `DisplayPanel` 加入卡片式選擇器，並在既有 `MonitorMockup` 的 mini popup 內渲染對應 Lucide icon。

**Tech Stack:** NestJS + Prisma (PostgreSQL)、Next.js 16 + React 19、Mantine v9、lucide-react（專案已使用）

---

## File Structure

| 動作 | 路徑 | 說明 |
|------|------|------|
| Modify | `backend/prisma/schema.prisma` | 新增 `MascotIcon` enum + `mascotIcon` 欄位 |
| Modify | `backend/src/common/enums.ts` | 新增 `MascotIcon` TypeScript enum |
| Modify | `backend/src/display-settings/dto/update-display-setting.dto.ts` | 新增 `mascotIcon` 欄位 |
| Create | `backend/src/display-settings/dto/update-display-setting.dto.spec.ts` | DTO 驗證單元測試 |
| Modify | `frontend/src/components/DisplayPanel.tsx` | 型別 + 選擇器 UI + MonitorMockup icon |
| Modify | `frontend/src/app/page.tsx` | `saveDisplaySetting` payload 加 `mascotIcon` |

---

## Task 1：後端 Schema + Migration

**Files:**
- Modify: `backend/prisma/schema.prisma`

- [ ] **Step 1：在 `schema.prisma` 中加入 `MascotIcon` enum 並更新 `DisplaySetting`**

  在 `MascotMode` enum（第 40 行）**之後**插入：

  ```prisma
  enum MascotIcon {
    bell_ring
    sparkles
    calendar_clock
  }
  ```

  在 `DisplaySetting` model（`mascotMode` 行之後）新增欄位：

  ```prisma
  mascotIcon    MascotIcon    @default(bell_ring)
  ```

  完整 `DisplaySetting` model 變為：

  ```prisma
  model DisplaySetting {
    id             String        @id @default(uuid())
    size           PopupSize     @default(medium)
    theme          PopupTheme    @default(light)
    corner         PopupCorner   @default(bottom_right)
    showContent    Boolean       @default(true)
    targetScreenId String?       @db.VarChar(100)
    mascotMode     MascotMode    @default(system)
    mascotIcon     MascotIcon    @default(bell_ring)
    mascotImages   MascotImage[]
  }
  ```

- [ ] **Step 2：執行 migration**

  在 `backend/` 目錄執行：

  ```bash
  npx prisma migrate dev --name add-mascot-icon
  ```

  預期輸出包含：
  ```
  ✔ Generated Prisma Client
  The following migration(s) have been applied:
    migrations/YYYYMMDD_add-mascot-icon/migration.sql
  ```

  若出現 `Cannot find module '@prisma/client'` 請先執行 `npm run build` 或 `npx prisma generate`。

- [ ] **Step 3：確認 migration SQL 正確**

  ```bash
  cat prisma/migrations/$(ls prisma/migrations | grep mascot)/migration.sql
  ```

  預期包含：
  ```sql
  CREATE TYPE "MascotIcon" AS ENUM ('bell_ring', 'sparkles', 'calendar_clock');
  ALTER TABLE "DisplaySetting" ADD COLUMN "mascotIcon" "MascotIcon" NOT NULL DEFAULT 'bell_ring';
  ```

- [ ] **Step 4：Commit**

  ```bash
  git add backend/prisma/schema.prisma backend/prisma/migrations/
  git commit -m "feat(db): add MascotIcon enum and mascotIcon field to DisplaySetting"
  ```

---

## Task 2：後端 TypeScript Enum + DTO + 測試

**Files:**
- Modify: `backend/src/common/enums.ts`
- Modify: `backend/src/display-settings/dto/update-display-setting.dto.ts`
- Create: `backend/src/display-settings/dto/update-display-setting.dto.spec.ts`

- [ ] **Step 1：在 `enums.ts` 末尾新增 `MascotIcon` enum**

  開啟 `backend/src/common/enums.ts`，在 `MascotMode` enum（最後一個）**之後**加入：

  ```ts
  export enum MascotIcon {
    BELL_RING = 'bell_ring',
    SPARKLES = 'sparkles',
    CALENDAR_CLOCK = 'calendar_clock',
  }
  ```

- [ ] **Step 2：撰寫 DTO 的失敗測試**

  建立 `backend/src/display-settings/dto/update-display-setting.dto.spec.ts`：

  ```ts
  import { validate } from 'class-validator';
  import { plainToInstance } from 'class-transformer';
  import { UpdateDisplaySettingDto } from './update-display-setting.dto';

  describe('UpdateDisplaySettingDto', () => {
    it('accepts valid mascotIcon bell_ring', async () => {
      const dto = plainToInstance(UpdateDisplaySettingDto, { mascotIcon: 'bell_ring' });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('accepts valid mascotIcon sparkles', async () => {
      const dto = plainToInstance(UpdateDisplaySettingDto, { mascotIcon: 'sparkles' });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('rejects invalid mascotIcon value', async () => {
      const dto = plainToInstance(UpdateDisplaySettingDto, { mascotIcon: 'invalid_value' });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'mascotIcon')).toBe(true);
    });

    it('accepts missing mascotIcon (optional)', async () => {
      const dto = plainToInstance(UpdateDisplaySettingDto, {});
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });
  });
  ```

- [ ] **Step 3：執行測試，確認失敗（mascotIcon 欄位尚未加入 DTO）**

  ```bash
  npm test -- --testPathPattern=update-display-setting.dto.spec --verbose
  ```

  預期：3 個測試失敗（`mascotIcon` 尚不存在）。

- [ ] **Step 4：更新 `update-display-setting.dto.ts`**

  在 `update-display-setting.dto.ts` 中加入 import 與欄位：

  ```ts
  import { ApiPropertyOptional } from '@nestjs/swagger';
  import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
  import { MascotIcon, MascotMode, PopupCorner, PopupSize, PopupTheme } from '../../common/enums';

  export class UpdateDisplaySettingDto {
    @ApiPropertyOptional({ enum: PopupSize })
    @IsOptional()
    @IsEnum(PopupSize)
    size?: PopupSize;

    @ApiPropertyOptional({ enum: PopupTheme })
    @IsOptional()
    @IsEnum(PopupTheme)
    theme?: PopupTheme;

    @ApiPropertyOptional({ enum: PopupCorner })
    @IsOptional()
    @IsEnum(PopupCorner)
    corner?: PopupCorner;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    showContent?: boolean;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(100)
    targetScreenId?: string;

    @ApiPropertyOptional({ enum: MascotMode })
    @IsOptional()
    @IsEnum(MascotMode)
    mascotMode?: MascotMode;

    @ApiPropertyOptional({ enum: MascotIcon })
    @IsOptional()
    @IsEnum(MascotIcon)
    mascotIcon?: MascotIcon;
  }
  ```

- [ ] **Step 5：執行測試，確認通過**

  ```bash
  npm test -- --testPathPattern=update-display-setting.dto.spec --verbose
  ```

  預期：4 個測試全部 PASS。

- [ ] **Step 6：執行全部測試確認無 regression**

  ```bash
  npm test -- --passWithNoTests
  ```

  預期：所有測試 PASS。

- [ ] **Step 7：Commit**

  ```bash
  git add backend/src/common/enums.ts \
          backend/src/display-settings/dto/update-display-setting.dto.ts \
          backend/src/display-settings/dto/update-display-setting.dto.spec.ts
  git commit -m "feat(api): add MascotIcon enum and mascotIcon field to UpdateDisplaySettingDto"
  ```

---

## Task 3：前端型別 + saveDisplaySetting

**Files:**
- Modify: `frontend/src/components/DisplayPanel.tsx`（只改型別）
- Modify: `frontend/src/app/page.tsx`

- [ ] **Step 1：更新 `DisplaySetting` 型別（`DisplayPanel.tsx` 第 16–24 行）**

  將 `DisplaySetting` type 改為：

  ```ts
  export type DisplaySetting = {
    id: string;
    size: 'small' | 'medium' | 'large';
    theme: 'light' | 'dark';
    corner: 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right';
    showContent: boolean;
    targetScreenId: string | null;
    mascotMode: 'system' | 'custom';
    mascotIcon: 'bell_ring' | 'sparkles' | 'calendar_clock';
  };
  ```

- [ ] **Step 2：更新 `saveDisplaySetting` payload（`page.tsx` 第 571–589 行附近）**

  找到 `saveDisplaySetting` 函式，將 body 中的 JSON.stringify 改為：

  ```ts
  body: JSON.stringify({
    size: displaySetting.size,
    theme: displaySetting.theme,
    corner: displaySetting.corner,
    showContent: displaySetting.showContent,
    targetScreenId: displaySetting.targetScreenId ?? '',
    mascotMode: displaySetting.mascotMode,
    mascotIcon: displaySetting.mascotIcon,
  }),
  ```

- [ ] **Step 3：確認 TypeScript 無型別錯誤**

  在 `frontend/` 目錄：

  ```bash
  npx tsc --noEmit
  ```

  預期：無錯誤輸出。

- [ ] **Step 4：Commit**

  ```bash
  git add frontend/src/components/DisplayPanel.tsx frontend/src/app/page.tsx
  git commit -m "feat(frontend): add mascotIcon to DisplaySetting type and save payload"
  ```

---

## Task 4：前端 UI（選擇器 + MonitorMockup 圖示）

**Files:**
- Modify: `frontend/src/components/DisplayPanel.tsx`

- [ ] **Step 1：在 `DisplayPanel.tsx` 頂部加入 imports**

  在 `'use client';` 之後、現有 import 之前加入：

  ```ts
  import type { ComponentType } from 'react';
  ```

  在 lucide-react import 加入三個 icon（或新增一行）：

  ```ts
  import { BellRing, CalendarClock, Sparkles } from 'lucide-react';
  ```

  在 Mantine import 中加入 `UnstyledButton`：

  ```ts
  import {
    Button,
    Group,
    Select,
    Stack,
    Switch,
    Text,
    TextInput,
    Title,
    UnstyledButton,
  } from '@mantine/core';
  ```

- [ ] **Step 2：在 `popupWidthMap` 常數下方（約第 51 行）新增 mascot 選項陣列**

  ```ts
  type MascotOption = { value: DisplaySetting['mascotIcon']; label: string; Icon: ComponentType<{ size?: number }> };

  const mascotOptions: MascotOption[] = [
    { value: 'bell_ring', label: '鈴鐺', Icon: BellRing },
    { value: 'sparkles', label: '閃光', Icon: Sparkles },
    { value: 'calendar_clock', label: '日曆時鐘', Icon: CalendarClock },
  ];
  ```

- [ ] **Step 3：在 `MonitorMockup` 中渲染吉祥物圖示**

  在 `MonitorMockup` function 內（約第 53 行）：

  首先在函式頂部新增：

  ```ts
  const MASCOT_ICON_MAP: Record<DisplaySetting['mascotIcon'], React.ElementType> = {
    bell_ring: BellRing,
    sparkles: Sparkles,
    calendar_clock: CalendarClock,
  };
  const MascotIcon = MASCOT_ICON_MAP[displaySetting.mascotIcon];
  ```

  然後在 mini popup 的標題 `<div>`（大約在 `{form?.title || '提醒標題預覽'}` 之前）插入吉祥物圖示行：

  ```tsx
  {/* 吉祥物圖示 */}
  <div style={{ marginBottom: 4, color: titleColor }}>
    <MascotIcon size={12} />
  </div>
  ```

  完整的 mini popup 內容區域變為：

  ```tsx
  {/* 吉祥物圖示 */}
  <div style={{ marginBottom: 4, color: titleColor }}>
    <MascotIcon size={12} />
  </div>
  <div
    style={{
      fontSize: 9.5,
      fontWeight: 700,
      color: titleColor,
      marginBottom: 3,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    }}
  >
    {form?.title || '提醒標題預覽'}
  </div>
  {displaySetting.showContent ? (
    <div
      style={{
        fontSize: 7.5,
        color: subtitleColor,
        marginBottom: 7,
        lineHeight: 1.45,
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      }}
    >
      {form?.content || '提醒內容說明文字'}
    </div>
  ) : (
    <div style={{ marginBottom: 4 }} />
  )}
  ```

- [ ] **Step 4：在 `DisplayPanel` 函式中加入吉祥物選擇器 UI**

  在 `<Switch ...showContent... />` 區塊（約第 294 行）**之後**、`<MonitorMockup />` **之前**插入：

  ```tsx
  <div>
    <Text size="sm" fw={500} mb={6}>
      吉祥物圖示
    </Text>
    <Group gap="sm">
      {mascotOptions.map(({ value, label, Icon }) => {
        const isSelected = displaySetting.mascotIcon === value;
        return (
          <UnstyledButton
            key={value}
            onClick={() => onChange({ ...displaySetting, mascotIcon: value })}
            style={{
              border: `2px solid ${isSelected ? 'var(--mantine-color-indigo-5)' : 'var(--mantine-color-default-border)'}`,
              borderRadius: 8,
              padding: '8px 14px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
              background: isSelected ? 'var(--mantine-color-indigo-0)' : 'transparent',
              minWidth: 72,
            }}
          >
            <Icon size={20} />
            <Text size="xs" c={isSelected ? 'indigo' : undefined}>
              {label}
            </Text>
          </UnstyledButton>
        );
      })}
    </Group>
  </div>
  ```

- [ ] **Step 5：確認 TypeScript 無型別錯誤**

  ```bash
  cd frontend && npx tsc --noEmit
  ```

  預期：無錯誤。

- [ ] **Step 6：在瀏覽器中手動驗收**

  確認前端 dev server 已啟動（`http://localhost:3001`）。

  1. 切換到「顯示工具」分頁
  2. 確認看到「吉祥物圖示」選擇器，顯示三個卡片：鈴鐺 / 閃光 / 日曆時鐘
  3. 點擊「閃光」卡片 → 卡片出現 indigo 邊框，MonitorMockup 的 mini popup 左上角圖示變為 Sparkles
  4. 點擊「儲存顯示設定」
  5. 重整頁面 → 確認「閃光」卡片仍為選中狀態（設定已持久化）

- [ ] **Step 7：Commit**

  ```bash
  git add frontend/src/components/DisplayPanel.tsx
  git commit -m "feat(frontend): add mascot icon picker and MonitorMockup icon display"
  ```

- [ ] **Step 8：Push**

  ```bash
  git push origin main
  ```
