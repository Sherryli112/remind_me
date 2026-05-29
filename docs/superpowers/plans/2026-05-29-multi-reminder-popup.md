# Multi-Reminder Popup Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **NOTE:** Do NOT bump version or create git tags when complete. Leave that to the user.

**Goal:** Replace per-reminder Tauri windows with a single `popup-manager` window that stacks simultaneous reminders into a collapsible, scrollable panel.

**Architecture:** Rust emits a `reminders-updated` Tauri event with the full pending list whenever due reminders arrive. A single transparent `popup-manager` Tauri window hosts a Next.js page that manages all UI states (single / collapsed-multi / expanded). The frontend calls `invoke("resize_popup")` to resize and reposition the window on every state change.

**Tech Stack:** Rust/Tauri v2, Next.js 14 (static export), lucide-react, @tauri-apps/api v2

---

## File Map

| Path | Action | Purpose |
|------|--------|---------|
| `src-tauri/src/popup.rs` | Modify | Extract `pub(crate) calc_popup_position` |
| `src-tauri/src/popup_manager.rs` | **Create** | Window lifecycle + event emission + Tauri state |
| `src-tauri/src/lib.rs` | Modify | Add mod, manage state, register new commands |
| `src-tauri/src/scheduler.rs` | Modify | Call `popup_manager::show_reminders` instead of `open_popup` |
| `frontend/src/app/popup-manager/height.ts` | **Create** | Pure `calcWindowHeight` utility |
| `frontend/src/app/popup-manager/height.test.ts` | **Create** | Unit tests for height calc |
| `frontend/src/app/popup-manager/popup-manager.css` | **Create** | Transparent container CSS |
| `frontend/src/app/popup-manager/layout.tsx` | **Create** | Route layout |
| `frontend/src/app/popup-manager/page.tsx` | **Create** | Full multi-reminder UI |

---

### Task 1: Refactor `popup.rs` — extract shared position calculation

**Files:**
- Modify: `src-tauri/src/popup.rs`

- [ ] **Step 1: Extract `card_size` and `calc_popup_position` as `pub(crate)` functions**

Replace the inline size/position logic in `open_popup` with two extracted functions:

```rust
// src-tauri/src/popup.rs  (add before open_popup)

pub(crate) fn card_size(size: &str) -> (f64, f64) {
    match size {
        "small" => (220.0, 105.0),
        "large" => (310.0, 160.0),
        _ => (265.0, 130.0),
    }
}

pub(crate) fn calc_popup_position(
    app: &AppHandle,
    width: f64,
    height: f64,
    corner: &str,
    target_screen_id: Option<&str>,
) -> (f64, f64) {
    let monitor = target_screen_id
        .and_then(|name| {
            app.available_monitors()
                .ok()
                .into_iter()
                .flatten()
                .find(|m| m.name().is_some_and(|n| n == name))
        })
        .or_else(|| app.primary_monitor().ok().flatten())
        .expect("No monitor found");
    let scale = monitor.scale_factor();
    let margin = 16.0;

    #[cfg(target_os = "windows")]
    let (work_x, work_y, work_w, work_h) = monitor_work_area(
        monitor.position().x,
        monitor.position().y,
        scale,
    );
    #[cfg(not(target_os = "windows"))]
    let (work_x, work_y, work_w, work_h) = {
        let x = monitor.position().x as f64 / scale;
        let y = monitor.position().y as f64 / scale;
        let w = monitor.size().width as f64 / scale;
        let h = monitor.size().height as f64 / scale;
        (x, y, w, h)
    };

    match corner {
        "top_left"    => (work_x + margin,                    work_y + margin),
        "top_right"   => (work_x + work_w - width - margin,   work_y + margin),
        "bottom_left" => (work_x + margin,                    work_y + work_h - height - margin),
        _             => (work_x + work_w - width - margin,   work_y + work_h - height - margin),
    }
}
```

- [ ] **Step 2: Update `open_popup` to use the extracted functions**

Replace the inline size + position calculation in `open_popup`:

```rust
pub fn open_popup(app: &AppHandle, reminder: &DueReminder) -> Result<(), tauri::Error> {
    let label = format!("popup-{}", &reminder.id[..8]);
    if app.get_webview_window(&label).is_some() {
        return Ok(());
    }

    let (width, height) = card_size(&reminder.size);
    let (x, y) = calc_popup_position(
        app,
        width,
        height,
        &reminder.corner,
        reminder.target_screen_id.as_deref(),
    );

    let url = WebviewUrl::App(format!("popup?id={}", reminder.id).into());

    WebviewWindowBuilder::new(app, label, url)
        .title("")
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .inner_size(width, height)
        .position(x, y)
        .visible(true)
        .build()?;

    Ok(())
}
```

- [ ] **Step 3: Build to confirm no regressions**

```
cd src-tauri && cargo check 2>&1
```

Expected: no errors.

- [ ] **Step 4: Commit**

```
git add src-tauri/src/popup.rs
git commit -m "refactor(popup): extract calc_popup_position and card_size as pub(crate)"
```

---

### Task 2: Create `src-tauri/src/popup_manager.rs`

**Files:**
- Create: `src-tauri/src/popup_manager.rs`

- [ ] **Step 1: Create the file with full implementation**

```rust
// src-tauri/src/popup_manager.rs

use crate::popup::{calc_popup_position, card_size, DueReminder};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

const LABEL: &str = "popup-manager";

/// Tauri managed state — holds the last-emitted reminder list so the
/// frontend can fetch it on first load (avoids the event/render race).
pub struct PopupManagerState {
    pub pending: Mutex<Vec<DueReminder>>,
}

pub fn show_reminders(app: &AppHandle, reminders: &[DueReminder]) {
    // Always update state (frontend fetches this on init)
    if let Some(state) = app.try_state::<PopupManagerState>() {
        *state.pending.lock().unwrap() = reminders.to_vec();
    }

    if reminders.is_empty() {
        if let Some(w) = app.get_webview_window(LABEL) {
            let _ = w.hide();
        }
        return;
    }

    let first = &reminders[0];
    let (width, init_height) = collapsed_size(&first.size);

    let window = match app.get_webview_window(LABEL) {
        Some(w) => w,
        None => {
            let (x, y) = calc_popup_position(
                app,
                width,
                init_height,
                &first.corner,
                first.target_screen_id.as_deref(),
            );
            let url = WebviewUrl::App("popup-manager".into());
            WebviewWindowBuilder::new(app, LABEL, url)
                .title("")
                .decorations(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .resizable(false)
                .transparent(true)
                .inner_size(width, init_height)
                .position(x, y)
                .visible(false)
                .build()
                .expect("failed to create popup-manager window")
        }
    };

    let _ = window.emit("reminders-updated", reminders);
    let _ = window.show();
}

/// Initial height for the collapsed state (1 card + arrow space + padding).
fn collapsed_size(size: &str) -> (f64, f64) {
    let (w, card_h) = card_size(size);
    (w, card_h + 20.0 + 8.0) // arrow_space=20, inner_padding=8
}
```

- [ ] **Step 2: Build check**

```
cd src-tauri && cargo check 2>&1
```

Expected: errors about `popup_manager` not being a module yet (fixed in Task 3).

---

### Task 3: Update `lib.rs` and `scheduler.rs`

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/scheduler.rs`

- [ ] **Step 1: Add the three new Tauri commands and `mod popup_manager` to `lib.rs`**

Add after the existing `use` imports at the top of `lib.rs`:

```rust
mod popup_manager;
```

Add these three commands before `pub fn run()`:

```rust
#[tauri::command]
fn get_pending_reminders(
    state: tauri::State<'_, popup_manager::PopupManagerState>,
) -> Vec<popup::DueReminder> {
    state.pending.lock().unwrap().clone()
}

#[tauri::command]
fn resize_popup(
    app: tauri::AppHandle,
    width: f64,
    height: f64,
    corner: String,
    target_screen_id: Option<String>,
) -> Result<(), String> {
    use popup::calc_popup_position;
    if let Some(window) = app.get_webview_window("popup-manager") {
        let (x, y) = calc_popup_position(&app, width, height, &corner, target_screen_id.as_deref());
        window.set_size(tauri::LogicalSize::new(width, height)).map_err(|e| e.to_string())?;
        window.set_position(tauri::LogicalPosition::new(x, y)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn hide_popup(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("popup-manager") {
        w.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}
```

- [ ] **Step 2: Register state and commands in `pub fn run()`**

In `lib.rs`, inside `.setup(|app| { ... })`, add after `tray::setup_tray(&app_handle)?;`:

```rust
app.manage(popup_manager::PopupManagerState {
    pending: std::sync::Mutex::new(Vec::new()),
});
```

Update `.invoke_handler(...)` to include the three new commands:

```rust
.invoke_handler(tauri::generate_handler![
    get_autostart,
    set_autostart,
    get_pending_reminders,
    resize_popup,
    hide_popup,
])
```

- [ ] **Step 3: Update `scheduler.rs` to call `popup_manager`**

Replace the entire file content:

```rust
// src-tauri/src/scheduler.rs

use crate::popup::DueReminder;
use crate::popup_manager;
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
                    popup_manager::show_reminders(&app, &reminders);
                }
                Err(e) => eprintln!("輪詢 /scheduler/due 失敗: {e}"),
            }
        }
    });
}
```

- [ ] **Step 4: Build to confirm everything compiles**

```
cd src-tauri && cargo check 2>&1
```

Expected: no errors.

- [ ] **Step 5: Commit**

```
git add src-tauri/src/popup_manager.rs src-tauri/src/lib.rs src-tauri/src/scheduler.rs
git commit -m "feat(rust): add popup-manager window, resize/hide commands, replace per-reminder windows"
```

---

### Task 4: Frontend — `height.ts` utility + tests

**Files:**
- Create: `frontend/src/app/popup-manager/height.ts`
- Create: `frontend/src/app/popup-manager/height.test.ts`

- [ ] **Step 1: Write the failing tests first**

```typescript
// frontend/src/app/popup-manager/height.test.ts

import { calcWindowHeight, CARD_WIDTH } from './height';

describe('calcWindowHeight', () => {
  it('0 reminders returns fallback card height', () => {
    expect(calcWindowHeight(0, false, 'medium', 900)).toBe(138);
  });

  it('1 reminder — no arrow space', () => {
    expect(calcWindowHeight(1, false, 'medium', 900)).toBe(138); // 130+8
  });

  it('1 reminder small size', () => {
    expect(calcWindowHeight(1, false, 'small', 900)).toBe(113); // 105+8
  });

  it('2 reminders collapsed — adds arrow space', () => {
    expect(calcWindowHeight(2, false, 'medium', 900)).toBe(158); // 20+130+8
  });

  it('2 reminders expanded — 1 full + 1 collapsed card', () => {
    // 130 + 1*(36+6) + 8 = 180
    expect(calcWindowHeight(2, true, 'medium', 900)).toBe(180);
  });

  it('3 reminders expanded', () => {
    // 130 + 2*(36+6) + 8 = 222
    expect(calcWindowHeight(3, true, 'medium', 900)).toBe(222);
  });

  it('caps at screenAvailableHeight', () => {
    expect(calcWindowHeight(20, true, 'medium', 200)).toBe(200);
  });

  it('CARD_WIDTH exports correct values', () => {
    expect(CARD_WIDTH.small).toBe(220);
    expect(CARD_WIDTH.medium).toBe(265);
    expect(CARD_WIDTH.large).toBe(310);
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```
cd frontend && npx jest height.test.ts --no-coverage 2>&1
```

Expected: FAIL — `height.ts` does not exist.

- [ ] **Step 3: Implement `height.ts`**

```typescript
// frontend/src/app/popup-manager/height.ts

export const CARD_HEIGHT = { small: 105, medium: 130, large: 160 } as const;
export const CARD_WIDTH  = { small: 220, medium: 265, large: 310 } as const;

const ARROW_SPACE       = 20;   // space for ChevronsUp/Down indicator
const COLLAPSED_CARD_H  = 36;   // collapsed mini-card row height
const GAP               = 6;    // gap between cards
const INNER_PADDING     = 8;    // padding inside window at the edge

/**
 * Returns the required popup-manager window height in logical pixels.
 * The Rust resize_popup command will also reposition the window so this
 * height is correctly anchored to the configured corner.
 */
export function calcWindowHeight(
  count: number,
  isExpanded: boolean,
  size: 'small' | 'medium' | 'large',
  screenAvailableHeight: number,
): number {
  const cardH = CARD_HEIGHT[size];

  if (count <= 1) return cardH + INNER_PADDING;

  if (!isExpanded) {
    // collapsed: arrow + single full card
    return ARROW_SPACE + cardH + INNER_PADDING;
  }

  // expanded: 1 full card + (count-1) collapsed cards
  const total = cardH + (count - 1) * (COLLAPSED_CARD_H + GAP) + INNER_PADDING;
  return Math.min(total, screenAvailableHeight);
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```
cd frontend && npx jest height.test.ts --no-coverage 2>&1
```

Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```
git add frontend/src/app/popup-manager/height.ts frontend/src/app/popup-manager/height.test.ts
git commit -m "feat(frontend): add calcWindowHeight utility with tests"
```

---

### Task 5: Frontend — CSS and layout

**Files:**
- Create: `frontend/src/app/popup-manager/popup-manager.css`
- Create: `frontend/src/app/popup-manager/layout.tsx`

- [ ] **Step 1: Create `popup-manager.css`**

```css
/* frontend/src/app/popup-manager/popup-manager.css */

/* Fully transparent container — cards render their own backgrounds */
html {
  background: transparent !important;
  overflow: hidden !important;
  margin: 0 !important;
  padding: 0 !important;
}

body {
  background: transparent !important;
  overflow: hidden !important;
  margin: 0 !important;
  padding: 0 !important;
}

/* Hide scrollbars everywhere in this route */
* {
  scrollbar-width: none;
}
*::-webkit-scrollbar {
  display: none;
}

/* Arrow bob animation */
@keyframes arrow-bob {
  0%, 100% { transform: translateY(0);    opacity: 0.58; }
  50%       { transform: translateY(-5px); opacity: 0.92; }
}
```

- [ ] **Step 2: Create `layout.tsx`**

```tsx
// frontend/src/app/popup-manager/layout.tsx

import './popup-manager.css';

export default function PopupManagerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
```

- [ ] **Step 3: Commit**

```
git add frontend/src/app/popup-manager/popup-manager.css frontend/src/app/popup-manager/layout.tsx
git commit -m "feat(frontend): add popup-manager route CSS and layout"
```

---

### Task 6: Frontend — `page.tsx` (full UI)

**Files:**
- Create: `frontend/src/app/popup-manager/page.tsx`

- [ ] **Step 1: Create the file**

```tsx
// frontend/src/app/popup-manager/page.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import {
  BellRing, CalendarClock, ChevronsDown, ChevronsUp,
  Clock, Pointer, Sparkles,
} from 'lucide-react';
import { calcWindowHeight, CARD_HEIGHT, CARD_WIDTH } from './height';

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';

// ── Types ──────────────────────────────────────────────────────────────
type DueReminder = {
  id: string;
  title: string;
  content: string;
  autoCloseEnabled: boolean;
  autoCloseSeconds: number;
  snoozeDefaultSeconds: number;
  corner: string;
  size: 'small' | 'medium' | 'large';
  targetScreenId: string | null;
};

type DisplaySetting = {
  size: 'small' | 'medium' | 'large';
  theme: 'light' | 'dark';
  showContent: boolean;
  mascotIcon: 'bell_ring' | 'sparkles' | 'calendar_clock';
  corner: string;
  targetScreenId: string | null;
};

// ── Icon sizes ─────────────────────────────────────────────────────────
const ICON_SZ    = { small: 13, medium: 14, large: 15 } as const;
const TEXT_SZ    = { small: 11, medium: 12, large: 13 } as const;
const CONTENT_SZ = { small: 10, medium: 11, large: 12 } as const;
const PADDING    = { small: '8px 10px', medium: '10px 12px', large: '11px 14px' } as const;

// ── Sub-components ─────────────────────────────────────────────────────

function MascotIcon({ icon, size }: { icon: string; size: number }) {
  const p = { size, strokeWidth: 1.5 };
  if (icon === 'sparkles') return <Sparkles {...p} />;
  if (icon === 'calendar_clock') return <CalendarClock {...p} />;
  return <BellRing {...p} />;
}

function ArrowIndicator({ corner, onClick }: { corner: string; onClick: () => void }) {
  const isTop = corner.startsWith('top');
  const Icon = isTop ? ChevronsDown : ChevronsUp;
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        justifyContent: 'center',
        cursor: 'pointer',
        color: 'rgba(255,255,255,0.58)',
        animation: 'arrow-bob 1.5s ease-in-out infinite',
        lineHeight: 0,
        position: 'relative',
        zIndex: 10,
        // Overlap card edge by ~8px
        marginBottom: isTop ? 0 : -8,
        marginTop:    isTop ? -8 : 0,
      }}
    >
      <Icon size={22} strokeWidth={2.5} />
    </div>
  );
}

function CollapsedCard({
  reminder,
  display,
  onExpand,
}: {
  reminder: DueReminder;
  display: DisplaySetting;
  onExpand: () => void;
}) {
  const isDark = display.theme === 'dark';
  const sz = display.size;
  return (
    <div
      onClick={onExpand}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 12px',
        height: 36,
        borderRadius: 10,
        background: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(28,24,72,0.08)',
        backdropFilter: 'blur(8px)',
        border: isDark
          ? '1px solid rgba(255,255,255,0.12)'
          : '1px solid rgba(99,102,241,0.15)',
        cursor: 'pointer',
        userSelect: 'none',
        boxSizing: 'border-box',
        flexShrink: 0,
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <span style={{
        color: isDark ? 'rgba(165,180,252,0.88)' : 'rgba(99,102,241,0.78)',
        lineHeight: 1, flexShrink: 0,
      }}>
        <MascotIcon icon={display.mascotIcon} size={ICON_SZ[sz]} />
      </span>
      <span style={{
        fontSize: TEXT_SZ[sz],
        fontWeight: 600,
        color: isDark ? 'rgba(235,235,255,0.9)' : 'rgba(28,24,72,0.85)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {reminder.title}
      </span>
    </div>
  );
}

function ExpandedCard({
  reminder,
  display,
  onClose,
  onSnooze,
}: {
  reminder: DueReminder;
  display: DisplaySetting;
  onClose: () => void;
  onSnooze: () => void;
}) {
  const [progress, setProgress] = useState(100);
  const [hovered, setHovered] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!reminder.autoCloseEnabled) return;
    const total = reminder.autoCloseSeconds * 1000;
    const start = Date.now();
    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - start;
      setProgress(Math.max(0, 100 - (elapsed / total) * 100));
      if (elapsed >= total) {
        clearInterval(timerRef.current!);
        onClose();
      }
    }, 200);
    return () => clearInterval(timerRef.current!);
  }, [reminder.id, reminder.autoCloseEnabled, reminder.autoCloseSeconds, onClose]);

  const sz    = display.size;
  const isDark = display.theme === 'dark';
  const fs    = TEXT_SZ[sz];
  const fsc   = CONTENT_SZ[sz];
  const isize = ICON_SZ[sz];

  const bg        = isDark
    ? (hovered ? 'rgba(18,14,48,0.97)' : 'rgba(18,14,48,0.82)')
    : (hovered ? 'rgba(235,239,255,0.98)' : 'rgba(235,239,255,0.84)');
  const borderCol = isDark
    ? (hovered ? 'rgba(129,140,248,0.55)' : 'rgba(99,102,241,0.25)')
    : (hovered ? 'rgba(165,180,252,0.8)'  : 'rgba(199,210,254,0.5)');
  const textCol = isDark ? 'rgba(235,235,255,0.95)' : 'rgba(28,24,72,0.92)';
  const dimCol  = isDark ? 'rgba(155,155,210,0.8)'  : 'rgba(99,102,241,0.68)';
  const iconCol = isDark ? 'rgba(165,180,252,0.88)' : 'rgba(99,102,241,0.78)';
  const btnBg   = isDark ? 'rgba(99,102,241,0.8)'   : 'rgba(99,102,241,0.88)';
  const snoozeB = isDark ? 'rgba(129,140,248,0.3)'  : 'rgba(199,210,254,0.8)';

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        boxSizing: 'border-box',
        padding: PADDING[sz],
        background: bg,
        border: `1px solid ${borderCol}`,
        borderRadius: 13,
        boxShadow: '0 0 0 2px rgba(108,142,245,0.3), 0 6px 24px rgba(0,0,0,0.25)',
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
        userSelect: 'none',
        cursor: 'default',
        transition: 'background 0.25s ease, border-color 0.25s ease',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        flexShrink: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0, color: iconCol, lineHeight: 1 }}>
          <MascotIcon icon={display.mascotIcon} size={isize} />
        </span>
        <span style={{
          flex: 1, minWidth: 0, fontSize: fs, fontWeight: 700, color: textCol,
          lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {reminder.title}
        </span>
      </div>

      {display.showContent && reminder.content && (
        <div style={{
          fontSize: fsc, color: dimCol, lineHeight: 1.3,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {reminder.content}
        </div>
      )}

      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {reminder.autoCloseEnabled && (
          <div style={{ height: 2, borderRadius: 2, background: isDark ? 'rgba(129,140,248,0.18)' : 'rgba(199,210,254,0.55)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${progress}%`, background: isDark ? 'rgba(129,140,248,0.85)' : 'rgba(99,102,241,0.65)', transition: 'width 0.2s linear' }} />
          </div>
        )}
        <div style={{ display: 'flex', gap: 5, justifyContent: 'flex-end', alignItems: 'center' }}>
          <button onClick={onSnooze} style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            fontSize: fsc, padding: '2px 7px',
            border: `1px solid ${snoozeB}`, borderRadius: 5,
            background: 'transparent', color: dimCol, cursor: 'pointer', whiteSpace: 'nowrap',
          }}>
            <Clock size={fsc - 1} />
            延後 {Math.round(reminder.snoozeDefaultSeconds / 60)} 分
          </button>
          <button onClick={onClose} style={{
            fontSize: fsc, padding: '2px 9px', border: 'none',
            borderRadius: 5, background: btnBg, color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap',
          }}>
            關閉
          </button>
        </div>
      </div>
    </div>
  );
}

function ScrollHint() {
  const [hovered, setHovered] = useState(false);
  return (
    <div style={{
      position: 'absolute', bottom: 0, left: 0, right: 0,
      height: 56, pointerEvents: 'none',
      background: 'linear-gradient(to bottom, transparent, rgba(0,0,0,0.35))',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      paddingBottom: 4,
    }}>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
          opacity: hovered ? 1 : 0.45, transition: 'opacity 0.2s',
          pointerEvents: 'auto', cursor: 'default', color: 'white',
        }}
      >
        <Pointer size={16} strokeWidth={1.5} />
        <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>
          滑動查看更多
        </span>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────
export default function PopupManagerPage() {
  const [reminders, setReminders]   = useState<DueReminder[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [display, setDisplay]       = useState<DisplaySetting | null>(null);
  const [isOverflow, setIsOverflow] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Fetch display settings once
  useEffect(() => {
    fetch(`${API}/display-settings/current`)
      .then((r) => r.json() as Promise<DisplaySetting>)
      .then(setDisplay)
      .catch(() => {});
  }, []);

  // Subscribe to reminders-updated Tauri event
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    import('@tauri-apps/api/event')
      .then(({ listen }) =>
        listen<DueReminder[]>('reminders-updated', (e) => {
          const incoming = e.payload;
          setReminders(incoming);
          setExpandedId(incoming[0]?.id ?? null);
          setIsExpanded(false);
        })
      )
      .then((fn) => { unlisten = fn; })
      .catch(() => {});
    return () => unlisten?.();
  }, []);

  // Fetch initial pending reminders on mount (handles first-load race condition)
  useEffect(() => {
    import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke<DueReminder[]>('get_pending_reminders'))
      .then((pending) => {
        if (pending.length > 0) {
          setReminders(pending);
          setExpandedId(pending[0].id);
        }
      })
      .catch(() => {});
  }, []);

  // Resize + reposition window on state change
  useEffect(() => {
    if (!display) return;
    const { size, corner, targetScreenId } = display;
    const count = reminders.length;

    import('@tauri-apps/api/core').then(({ invoke }) => {
      if (count === 0) {
        invoke('hide_popup').catch(() => {});
        return;
      }
      const w = CARD_WIDTH[size];
      const h = calcWindowHeight(count, isExpanded, size, window.screen.availHeight);
      invoke('resize_popup', { width: w, height: h, corner, targetScreenId }).catch(() => {});
    }).catch(() => {});
  }, [reminders, isExpanded, display]);

  // Detect scroll overflow
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const check = () => setIsOverflow(el.scrollHeight > el.clientHeight + 4);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [reminders, isExpanded]);

  function removeReminder(id: string) {
    setReminders((prev) => {
      const next = prev.filter((r) => r.id !== id);
      if (next.length > 0) {
        setExpandedId((cur) =>
          next.find((r) => r.id === cur) ? cur : next[0].id
        );
      }
      return next;
    });
    setIsExpanded(false);
  }

  function handleClose(id: string) {
    removeReminder(id);
  }

  async function handleSnooze(id: string, seconds: number) {
    try {
      await fetch(`${API}/reminders/${id}/snooze`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seconds }),
      });
    } catch {}
    removeReminder(id);
  }

  if (!display || reminders.length === 0) return null;

  const isTop = display.corner.startsWith('top');
  const activeId = expandedId ?? reminders[0].id;
  const expandedReminder = reminders.find((r) => r.id === activeId) ?? reminders[0];
  const collapsedReminders = reminders.filter((r) => r.id !== expandedReminder.id);
  const showArrow = reminders.length > 1 && !isExpanded;

  // Card order: priority (expanded) first — justifyContent handles corner alignment
  const cardList = [expandedReminder, ...collapsedReminders];

  return (
    <div style={{
      position: 'fixed', inset: 0,
      display: 'flex', flexDirection: 'column',
      justifyContent: isTop ? 'flex-start' : 'flex-end',
    }}>
      {/* ── Collapsed view ── */}
      {!isExpanded && (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {showArrow && !isTop && (
            <ArrowIndicator corner={display.corner} onClick={() => setIsExpanded(true)} />
          )}
          <ExpandedCard
            reminder={expandedReminder}
            display={display}
            onClose={() => handleClose(expandedReminder.id)}
            onSnooze={() => handleSnooze(expandedReminder.id, expandedReminder.snoozeDefaultSeconds)}
          />
          {showArrow && isTop && (
            <ArrowIndicator corner={display.corner} onClick={() => setIsExpanded(true)} />
          )}
        </div>
      )}

      {/* ── Expanded panel ── */}
      {isExpanded && (
        <div style={{ position: 'relative' }}>
          <div
            ref={scrollRef}
            style={{
              display: 'flex', flexDirection: 'column', gap: 6,
              overflowY: 'scroll', scrollbarWidth: 'none',
              maxHeight: `calc(100vh - 8px)`,
              padding: '4px 0',
            }}
          >
            {cardList.map((r) =>
              r.id === expandedReminder.id ? (
                <ExpandedCard
                  key={r.id}
                  reminder={r}
                  display={display}
                  onClose={() => handleClose(r.id)}
                  onSnooze={() => handleSnooze(r.id, r.snoozeDefaultSeconds)}
                />
              ) : (
                <CollapsedCard
                  key={r.id}
                  reminder={r}
                  display={display}
                  onExpand={() => setExpandedId(r.id)}
                />
              )
            )}
          </div>
          {isOverflow && <ScrollHint />}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add autoClose timer for CollapsedCards**

Inside `PopupManagerPage`, add this effect after the overflow-detection effect:

```tsx
// Auto-close collapsed cards that have autoCloseEnabled
useEffect(() => {
  const timers: ReturnType<typeof setTimeout>[] = [];
  collapsedReminders.forEach((r) => {
    if (!r.autoCloseEnabled) return;
    const id = setTimeout(() => handleClose(r.id), r.autoCloseSeconds * 1000);
    timers.push(id);
  });
  return () => timers.forEach(clearTimeout);
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [collapsedReminders.map((r) => r.id).join(',')]);
```

Note: `collapsedReminders` must be declared before this effect (move it outside the JSX return, at component scope after `activeId` is resolved):

```tsx
const collapsedReminders = reminders.filter((r) => r.id !== expandedReminder.id);
```

This line is already in the component — ensure it is declared **above** the new effect, not inside the return statement.

- [ ] **Step 3: Build the frontend**

```
cd frontend && npm run build 2>&1 | tail -20
```

Expected: Build succeeds with a new `out/popup-manager/` directory.

- [ ] **Step 3: Commit**

```
git add frontend/src/app/popup-manager/page.tsx
git commit -m "feat(frontend): add popup-manager page with collapsed/expanded/overflow states"
```

---

### Task 7: Integration test (manual)

- [ ] **Step 1: Start backend**

```
cd backend && npm run start:dev
```

- [ ] **Step 2: Start Tauri dev**

```
npm run tauri dev
```

- [ ] **Step 3: Test — single reminder**

Create one recurring reminder set to fire every 1 minute. Wait for it to appear.
Expected: Single card at corner, no arrow. Close button dismisses it.

- [ ] **Step 4: Test — two reminders simultaneously**

Set two reminders to the same interval so they both appear at once.
Expected: One card + ChevronsUp arrow above it (for bottom corner). Arrow bobs with animation, overlaps card top by ~8px.

- [ ] **Step 5: Test — expand panel**

Click the arrow.
Expected: Panel expands. Priority card (full) on top, second card collapsed below. No ✕ button visible.

- [ ] **Step 6: Test — switch expanded card**

Click the collapsed card.
Expected: It expands, original expanded card collapses.

- [ ] **Step 7: Test — close from expanded**

Close any card while panel is expanded.
Expected: Panel auto-collapses to single-card view.

- [ ] **Step 8: Test — overflow (3+ reminders)**

Fire 4+ simultaneous reminders.
Expected: Overflow state — cards clipped at bottom, finger + "滑動查看更多" appears in center at semi-transparent opacity; hover makes it fully opaque.

- [ ] **Step 9: Test — window hides when all dismissed**

Dismiss all cards one by one.
Expected: Window disappears (hides) when the last card is dismissed. Desktop is fully clickable in that area.

- [ ] **Step 10: Final commit confirming tests pass**

```
cd frontend && npx jest height.test.ts --no-coverage
```

Expected: 8 tests pass.

```
git add -A
git status
```

Confirm only expected files are staged (no accidental changes).
