# Multi-Reminder Popup Manager — Design Spec

## Goal

Replace the current "one Tauri window per reminder" approach with a single `popup-manager` window that stacks multiple simultaneous reminders into a collapsible, scrollable panel anchored to the configured screen corner.

## Architecture

### Overview

```
30s scheduler tick
  → GET /scheduler/due  →  [reminder1, reminder2, ...]
  → popup_manager::show_reminders(&app, reminders)
      → find or create "popup-manager" Tauri window
      → emit Tauri event "reminders-updated" with full list
  → Frontend receives event
      → update reminders state
      → invoke("resize_popup" | "hide_popup")
```

### Files

| Action | Path |
|--------|------|
| Create | `src-tauri/src/popup_manager.rs` |
| Create | `frontend/src/app/popup-manager/page.tsx` |
| Create | `frontend/src/app/popup-manager/layout.tsx` |
| Create | `frontend/src/app/popup-manager/popup-manager.css` |
| Modify | `src-tauri/src/scheduler.rs` |
| Modify | `src-tauri/src/lib.rs` |
| Keep   | `src-tauri/src/popup.rs` (not deleted — fallback) |
| Keep   | `frontend/src/app/popup/page.tsx` (not deleted) |

---

## UI State Machine

```
empty ──(新提醒到來)──→ single
single ──(再來 1+ 則)──→ collapsed-multi
collapsed-multi ──(點箭頭)──→ expanded
expanded ──(任意關閉/snooze)──→ collapsed-multi 或 single
any ──(reminders 清空)──→ empty → window.hide()
```

### State Definitions

| State | Condition | Window Visible |
|-------|-----------|----------------|
| `empty` | 0 reminders | No (`window.hide()`) |
| `single` | 1 reminder | Yes |
| `collapsed-multi` | 2+ reminders, panel closed | Yes |
| `expanded` | 2+ reminders, panel open | Yes |

### Transition Rules

- **empty → single / collapsed-multi**: triggered by incoming `reminders-updated` event
- **collapsed-multi → expanded**: user clicks the arrow indicator
- **expanded → collapsed-multi / single**: any card action (close or snooze) auto-collapses the panel
- **any → empty**: when reminders list drops to 0 after an action

---

## Visual Behavior

### Arrow Indicator (collapsed-multi only)

- **Icon**: `ChevronsUp` (bottom corners) / `ChevronsDown` (top corners) from `lucide-react`
- **Position**: absolutely positioned above (or below) the card, centered horizontally; bottom ~2 px overlaps the card's top (or top ~2 px overlaps card's bottom) edge
- **Style**: white, `opacity: 0.58`, no background
- **Animation**: CSS keyframes — `translateY(0 → -5px)` with `opacity 0.58 → 0.92`, 1.5 s ease-in-out infinite loop
- **Click**: toggles panel to `expanded`

### Expanded Panel — Card Types

**ExpandedCard** (exactly one at a time, the priority/topmost reminder):
- Full card: icon, title, content, Close button, Snooze button
- autoClose countdown progress bar (if `autoCloseEnabled`)
- Highlighted with a subtle blue outline (`box-shadow: 0 0 0 2px #6c8ef566`)

**CollapsedCard** (all other reminders):
- Semi-transparent frosted-glass background (`rgba(255,255,255,0.12)` + `backdrop-filter: blur(8px)`)
- Shows: icon + title only — content and buttons hidden
- Click → this card becomes `ExpandedCard`, previous one becomes `CollapsedCard`
- Only one card can be expanded at a time; no explicit collapse button

### Stacking Order

For **bottom corners**: cards stack upward from the corner. The ExpandedCard (priority) is at the top of the stack; last card is closest to the corner.

For **top corners**: cards stack downward from the corner. The ExpandedCard (priority) is at the bottom of the stack; last card is closest to the corner.

### Overflow & Scroll

- Cards container: `overflow-y: scroll; scrollbar-width: none` — native scroll, no visible scrollbar
- Scroll indicator shown when `scrollHeight > clientHeight`:
  - Overlay div positioned at the bottom-center of the panel
  - Contains: `Pointer` icon (lucide-react) + text "滑動查看更多"
  - `background: transparent`; `opacity: 0.45`; hover → `opacity: 1`; `transition: opacity 0.2s`
  - The partially-clipped bottom card provides visual affordance that more content exists

### autoClose Behavior

- **ExpandedCard**: shows countdown progress bar (existing behavior)
- **CollapsedCard**: frontend tracks a `setTimeout` for each collapsed card with `autoCloseEnabled`; no visual bar shown to reduce clutter; when timer fires → remove card from list silently (same as closing)
- When autoClose fires on a CollapsedCard: call `handleClose(id)` programmatically — no user interaction required

---

## Window Management

### Tauri Window Config (`popup-manager`)

```rust
WindowBuilder::new(app, "popup-manager")
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .transparent(true)
    .resizable(false)
    .visible(false)          // hidden until first reminders arrive
    .inner_size(width, initial_height)
    .position(x, y)
```

Width and initial position use the same corner/size calculation as the existing `popup.rs`.

### Dynamic Resize

Frontend calls `invoke("resize_popup", { height })` on every state change.

**Height calculation:**

```
CARD_HEIGHT = { small: 105, medium: 130, large: 160 }
ARROW_SPACE = 20
COLLAPSED_CARD_HEIGHT = 36   // icon + title row + padding
GAP = 6                      // gap between cards
MARGIN = 32                  // bottom margin above taskbar

collapsed_height = CARD_HEIGHT[size] + ARROW_SPACE + MARGIN
single_height    = CARD_HEIGHT[size] + MARGIN

expanded_height  = min(
  ARROW_SPACE + CARD_HEIGHT[size] + (n-1) * (COLLAPSED_CARD_HEIGHT + GAP) + MARGIN,
  screen_available_height        // monitor height minus taskbar
)
```

### Click-Through for Transparent Areas

- `empty`: `window.hide()` — fully removed from screen, zero desktop impact
- Other states: window sized to content area; transparent background regions outside cards use `setIgnoreCursorEvents` pattern (same as existing popup behavior)

### Tauri Commands (new, registered in `lib.rs`)

```rust
#[tauri::command]
fn resize_popup(app: AppHandle, height: f64) { ... }

#[tauri::command]
fn hide_popup(app: AppHandle) { ... }

#[tauri::command]
fn show_popup(app: AppHandle) { ... }
```

---

## Rust Side — `popup_manager.rs`

```rust
pub fn show_reminders(app: &AppHandle, reminders: Vec<DueReminderDto>) {
    if reminders.is_empty() {
        // hide window if it exists
        return;
    }
    let window = match app.get_webview_window("popup-manager") {
        Some(w) => w,
        None => create_popup_manager_window(app),
    };
    window.emit("reminders-updated", &reminders).unwrap();
    window.show().unwrap();
}
```

Position calculation reuses the same `monitor_work_area()` + corner logic from `popup.rs`.

---

## Frontend Side — `popup-manager/page.tsx`

### State

```typescript
const [reminders, setReminders]     = useState<DueReminderDto[]>([]);
const [expandedId, setExpandedId]   = useState<string | null>(null);
const [isExpanded, setIsExpanded]   = useState(false);
```

### Event Handling

```typescript
useEffect(() => {
  const unlisten = listen<DueReminderDto[]>('reminders-updated', (e) => {
    setReminders(prev => mergeDedupe(prev, e.payload));
  });
  return () => { unlisten.then(f => f()); };
}, []);
```

### Window Resize Effect

```typescript
useEffect(() => {
  if (reminders.length === 0) {
    invoke('hide_popup');
    return;
  }
  const height = calcHeight(reminders.length, isExpanded, size);
  invoke('resize_popup', { height });
}, [reminders, isExpanded]);
```

### Card Actions

```typescript
async function handleClose(id: string) {
  await fetch(`/reminders/${id}/dismiss`, { method: 'POST' });
  removeReminder(id);   // removes from state, auto-collapses panel
}

async function handleSnooze(id: string, seconds: number) {
  await fetch(`/reminders/${id}/snooze`, { method: 'PATCH',
    body: JSON.stringify({ seconds }) });
  removeReminder(id);
}

function removeReminder(id: string) {
  setReminders(prev => prev.filter(r => r.id !== id));
  setIsExpanded(false);   // always collapse after any action
  if (expandedId === id) setExpandedId(null);
}
```

### Expanded Card Priority

When `expandedId` is null (e.g. after a card is removed), default to `reminders[0].id`.

---

## Backend API — New Endpoint

```
POST /reminders/:id/dismiss
```

Marks the reminder as acknowledged for this firing window (adds to `firedSet` via `SchedulerService`). No DB write needed for one-time reminders (already handled by `firedSet`). For recurring reminders with `maxOccurrences`, increments `fireCount`.

This endpoint is distinct from DELETE (which deletes the reminder permanently).

---

## Backward Compatibility

- Old `popup.rs` and `/popup` page are **kept but unused** by the new scheduler path
- If `popup-manager` window creation fails, `scheduler.rs` logs the error and skips (no silent crash)
- Existing snooze API (`PATCH /reminders/:id/snooze`) is reused unchanged

---

## Out of Scope

- Drag-to-reorder reminders in the expanded panel
- Per-reminder corner override (all share the same DisplaySetting corner)
- Sound / vibration on popup appearance
