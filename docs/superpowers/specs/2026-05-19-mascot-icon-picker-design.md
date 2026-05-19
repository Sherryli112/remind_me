# 吉祥物圖示選擇器 設計文件

**日期：** 2026-05-19
**範圍：** §7 吉祥物自訂 UI（mascotMode = custom 無對應 UI）

---

## 背景

`DisplaySetting` 已有 `mascotMode: 'system' | 'custom'` 欄位，但前端 DisplayPanel 完全沒有對應的選擇 UI。`DesktopPopupPreview.tsx` 預覽元件早已廢棄且從未被 import。

本次目標：以 3 個預設 Lucide icon 取代自訂上傳（簡化實作），並補上即時預覽元件。

---

## 決策

- 新增 `mascotIcon` 欄位（3 值 enum），取代 `mascotMode` 的 UI 角色；`mascotMode` 欄位保留但前端不再顯示
- 3 個預設 icon：`bell_ring`（BellRing）、`sparkles`（Sparkles）、`calendar_clock`（CalendarClock）
- 預覽元件抽成獨立 `PopupPreview.tsx`，反映所有 displaySetting 設定項

---

## 一、資料模型

### 新增 `MascotIcon` enum

```prisma
enum MascotIcon {
  bell_ring
  sparkles
  calendar_clock
}
```

### `DisplaySetting` 新增欄位

```prisma
model DisplaySetting {
  // ...現有欄位不動...
  mascotIcon    MascotIcon    @default(bell_ring)
}
```

Migration：新增一欄並設預設值，現有資料全部自動填入 `bell_ring`，無 data migration。

---

## 二、後端 API

### `UpdateDisplaySettingDto` 新增

```ts
@IsOptional()
@IsEnum(MascotIcon)
mascotIcon?: MascotIcon;
```

### `display-settings.service.ts`

`updateCurrent` payload 新增 `mascotIcon` 欄位，讀取與更新邏輯不變。

### `display-settings.controller.ts`

`GET /display-settings/current` 回傳資料新增 `mascotIcon` 欄位（Prisma 自動 include）。

---

## 三、前端

### 新增 `PopupPreview.tsx`

獨立展示元件，接收 `displaySetting: DisplaySetting` 作為唯一 prop，無內部 state。

反映項目：
- `mascotIcon`：渲染對應 Lucide icon（`BellRing` / `Sparkles` / `CalendarClock`）
- `size`：`small` → 180px / `medium` → 240px / `large` → 300px 寬度
- `theme`：light/dark 切換 mock popup 背景色與文字色
- `corner`：mock popup 在預覽框內顯示於對應角落（top_left / top_right / bottom_left / bottom_right）
- `showContent`：切換是否顯示內容文字列

```
┌─ 預覽 ───────────────────────────────┐
│  ╔══════════════════╗                │
│  ║ 🔔  提醒標題     ║  ← popup mock  │
│  ║ 提醒內容文字     ║                │
│  ╚══════════════════╝                │
└──────────────────────────────────────┘
```

### 修改 `DisplayPanel.tsx`

**新增吉祥物選擇器區塊**（放在現有設定項末端，儲存按鈕之前）：

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│   BellRing  │  │  Sparkles   │  │ CalendarClock│
│    鈴鐺     │  │   閃光      │  │   日曆時鐘   │
└─────────────┘  └─────────────┘  └─────────────┘
```

- 使用 Mantine `UnstyledButton` 包裹，選中時加 border highlight（與現有 corner 選擇器風格一致）
- 點擊呼叫 `onChange({ ...displaySetting, mascotIcon: value })`

**新增 `PopupPreview` 使用**（設定區塊頂部）：

```tsx
<PopupPreview displaySetting={displaySetting} />
```

### 修改 `DisplayPanel.tsx` 型別

`DisplaySetting` 型別（定義於 `DisplayPanel.tsx`）新增欄位：

```ts
mascotIcon: 'bell_ring' | 'sparkles' | 'calendar_clock';
```

### 修改 `page.tsx`

- `saveDisplaySetting` payload 新增 `mascotIcon: displaySetting.mascotIcon`
- 桌面彈窗顯示提醒時，根據 `displaySetting.mascotIcon` 渲染對應 Lucide icon：

```ts
const MASCOT_ICONS: Record<string, React.ElementType> = {
  bell_ring: BellRing,
  sparkles: Sparkles,
  calendar_clock: CalendarClock,
}
```

---

## 四、不在本次範圍內

- 目標螢幕選擇器（需桌面殼層整合，獨立 issue）
- 自訂圖片上傳（`mascotMode = custom` 的原始規劃）
- `MascotImage` 關聯表的實際使用
- `mascotMode` 欄位的移除或重命名
