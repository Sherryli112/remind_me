# Autostart 開機自啟 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 RemindMe 預設在開機時自動啟動，並在「顯示工具」面板提供開關讓使用者控制。

**Architecture:** 使用 `tauri-plugin-autostart` 官方插件，Rust 曝露 `get_autostart` / `set_autostart` 兩個 Tauri 指令。首次啟動時自動寫入 Windows 登錄檔（使用 flag 檔案避免蓋掉用戶後續的設定）。前端在 `DisplayPanel` 新增「應用程式設定」區塊，mount 時讀取當前狀態，切換時即時寫入。

**Tech Stack:** Rust / Tauri v2、`tauri-plugin-autostart 2.x`、React (Next.js) / `@tauri-apps/api v2`、Mantine `Switch`

---

## 修改檔案總覽

| 檔案 | 動作 |
|------|------|
| `src-tauri/Cargo.toml` | 新增 `tauri-plugin-autostart = "2"` |
| `src-tauri/capabilities/default.json` | 新增 autostart 權限 |
| `src-tauri/src/lib.rs` | 註冊插件、加首次啟動邏輯、曝露兩個指令 |
| `frontend/src/components/DisplayPanel.tsx` | 新增「應用程式設定」區塊 + invoke |

---

### Task 1：新增 Rust 依賴

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1：在 `[dependencies]` 加入插件**

開啟 `src-tauri/Cargo.toml`，在 `[dependencies]` 區塊末尾加入：

```toml
tauri-plugin-autostart = "2"
```

最終 `[dependencies]` 區塊應如下（保留現有內容，只加這一行）：

```toml
[dependencies]
serde_json = "1.0"
serde = { version = "1.0", features = ["derive"] }
log = "0.4"
tauri = { version = "2.11.2", features = ["tray-icon"] }
tauri-plugin-log = "2"
reqwest = { version = "0.12", default-features = false, features = ["blocking", "json"] }
tauri-plugin-autostart = "2"
```

- [ ] **Step 2：確認可以編譯（只下載依賴，不執行）**

```powershell
cd src-tauri
cargo fetch
```

預期：無 error，成功下載 `tauri-plugin-autostart`。

- [ ] **Step 3：Commit**

```powershell
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore(deps): add tauri-plugin-autostart"
```

---

### Task 2：新增 capabilities 權限

**Files:**
- Modify: `src-tauri/capabilities/default.json`

- [ ] **Step 1：加入 autostart 權限**

開啟 `src-tauri/capabilities/default.json`，在 `"permissions"` 陣列末尾加入三條（逗號分隔）：

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "enables the default permissions",
  "windows": ["main", "popup-*"],
  "permissions": [
    "core:default",
    "core:tray:allow-new",
    "core:tray:allow-set-icon",
    "core:window:allow-create",
    "core:window:allow-close",
    "core:window:allow-show",
    "core:window:allow-hide",
    "autostart:allow-enable",
    "autostart:allow-disable",
    "autostart:allow-is-enabled"
  ]
}
```

- [ ] **Step 2：Commit**

```powershell
git add src-tauri/capabilities/default.json
git commit -m "chore(capabilities): add autostart permissions"
```

---

### Task 3：Rust — 插件、指令、首次啟動邏輯

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1：在 `lib.rs` 頂部加入 use 宣告**

在 `use tauri::{Manager, WindowEvent};` 那一行之後加入：

```rust
use tauri_plugin_autostart::ManagerExt;
```

完整頂部 imports 應為：

```rust
mod popup;
mod scheduler;
mod sidecar;
mod tray;

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Manager, WindowEvent};
use tauri_plugin_autostart::ManagerExt;
```

- [ ] **Step 2：在 `run()` 函式的 `tauri::Builder` 鏈中加入插件**

找到 `.plugin(tauri_plugin_log::Builder::default().build())` 那行，在其後面加上插件（兩行緊接）：

```rust
.plugin(tauri_plugin_log::Builder::default().build())
.plugin(tauri_plugin_autostart::init(
    tauri_plugin_autostart::MacosLauncher::LaunchAgent,
    Some(vec![]),
))
```

- [ ] **Step 3：在 `setup` 閉包末尾加入首次啟動自動啟用邏輯**

在 `setup` 閉包內，`tray::setup_tray(&app_handle)?;` 與 `scheduler::start_polling(app_handle);` 之後、`Ok(())` 之前加入：

```rust
// 首次啟動時預設啟用開機自啟；之後不再觸碰，保留使用者的設定
let init_flag = app_handle
    .path()
    .app_data_dir()
    .expect("no app data dir")
    .join("autostart_init");
if !init_flag.exists() {
    let _ = app_handle.autolaunch().enable();
    let _ = std::fs::write(&init_flag, "");
}
```

完整 `setup` 閉包結尾（在兩個 `#[cfg]` 區塊之後）應如下：

```rust
            if let Some(w) = app_handle.get_webview_window("main") {
                w.show()?;
                w.set_focus()?;
            }

            tray::setup_tray(&app_handle)?;
            scheduler::start_polling(app_handle.clone());

            let init_flag = app_handle
                .path()
                .app_data_dir()
                .expect("no app data dir")
                .join("autostart_init");
            if !init_flag.exists() {
                let _ = app_handle.autolaunch().enable();
                let _ = std::fs::write(&init_flag, "");
            }

            Ok(())
```

> **注意**：`scheduler::start_polling` 目前接收 `app_handle`（move），所以在它之前先 `.clone()` 一份給 `scheduler`，原本的 `app_handle` 留給後面的 autostart 邏輯。  
> 如果原始碼已經是 `start_polling(app_handle.clone())`，則無需修改。請先確認 `src-tauri/src/scheduler.rs` 的函式簽名。

- [ ] **Step 4：加入兩個 Tauri 指令**

在 `lib.rs` 頂層（`pub fn run()` 函式**之前**）加入：

```rust
#[tauri::command]
fn get_autostart(app: tauri::AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command]
fn set_autostart(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let manager = app.autolaunch();
    if enabled {
        manager.enable().map_err(|e| e.to_string())
    } else {
        manager.disable().map_err(|e| e.to_string())
    }
}
```

- [ ] **Step 5：在 Builder 中註冊指令**

在 `.build(tauri::generate_context!())` 之前，找到現有的 `.invoke_handler(...)` 或直接加在 `.on_window_event(...)` 之前：

```rust
.invoke_handler(tauri::generate_handler![get_autostart, set_autostart])
```

如果目前沒有 `.invoke_handler(...)`，就在 `.on_window_event(...)` 之前新增這一行。

- [ ] **Step 6：確認 Rust 編譯通過**

```powershell
cd src-tauri
cargo check
```

預期：`Finished` 無 error。若出現 `scheduler::start_polling` 移動語義錯誤，請依 Step 3 注意事項修正（把傳入 scheduler 的改成 `app_handle.clone()`）。

- [ ] **Step 7：Commit**

```powershell
git add src-tauri/src/lib.rs
git commit -m "feat(autostart): register plugin, expose commands, default-enable on first run"
```

---

### Task 4：Frontend — DisplayPanel 加入開機自啟開關

**Files:**
- Modify: `frontend/src/components/DisplayPanel.tsx`

- [ ] **Step 1：在檔案頂部加入 invoke import**

找到 `'use client';` 後面的第一個 import 區塊，加入：

```tsx
import { invoke } from '@tauri-apps/api/core';
```

- [ ] **Step 2：在 `Props` 型別中確認不需要額外 prop**

autostart 狀態由 DisplayPanel 自己管理（本地 state + invoke），不需要從 `page.tsx` 傳入。

- [ ] **Step 3：在 `export default function DisplayPanel(...)` 函式體內加入 state 與 effect**

在現有 state/effect 之後加入（具體位置：在第一個 `return` 之前）：

```tsx
const [autostartEnabled, setAutostartEnabled] = useState(false);
const [autostartLoading, setAutostartLoading] = useState(false);

useEffect(() => {
  invoke<boolean>('get_autostart')
    .then((v) => setAutostartEnabled(v))
    .catch(() => {/* 非 Tauri 環境（dev browser preview）靜默忽略 */});
}, []);

async function handleAutostartToggle(next: boolean) {
  setAutostartLoading(true);
  const prev = autostartEnabled;
  setAutostartEnabled(next); // 樂觀更新
  try {
    await invoke('set_autostart', { enabled: next });
  } catch {
    setAutostartEnabled(prev); // 失敗時 revert
  } finally {
    setAutostartLoading(false);
  }
}
```

- [ ] **Step 4：在面板 JSX 末尾加入「應用程式設定」區塊**

找到 DisplayPanel 的 `return (...)` 最外層 `<Stack>` 的**最後一個子元件結尾**，在 `</Stack>` 之前加入：

```tsx
<Stack gap="xs">
  <Text size="sm" fw={600} c="dimmed">
    應用程式設定
  </Text>
  <Switch
    label="開機時自動啟動"
    checked={autostartEnabled}
    disabled={autostartLoading}
    onChange={(event) => void handleAutostartToggle(event.currentTarget.checked)}
  />
</Stack>
```

- [ ] **Step 5：確認 TypeScript 編譯無誤**

```powershell
cd frontend
npx tsc --noEmit
```

預期：無 error。

- [ ] **Step 6：Commit**

```powershell
git add frontend/src/components/DisplayPanel.tsx
git commit -m "feat(frontend): add autostart toggle in DisplayPanel"
```

---

### Task 5：手動驗證

- [ ] **Step 1：啟動 app（dev 模式）**

先啟動後端：
```powershell
cd backend && npm run start:dev
```

另開 terminal：
```powershell
cd "C:\Users\jiaxinli\Desktop\RemindMe"
cargo tauri dev
```

- [ ] **Step 2：確認首次啟動自動寫入登錄檔**

開啟 regedit，導航至：
```
HKEY_CURRENT_USER\SOFTWARE\Microsoft\Windows\CurrentVersion\Run
```
應看到 `RemindMe` 項目（指向 app 執行檔路徑）。

- [ ] **Step 3：確認「顯示工具」面板有開關且預設為打勾**

點選左側「顯示工具」，滑到最下方，確認「應用程式設定 → 開機時自動啟動」Switch 為打勾狀態。

- [ ] **Step 4：關閉開關，確認登錄檔項目消失**

切換 Switch 為關閉，再到 regedit 確認 `RemindMe` 項目已不存在。

- [ ] **Step 5：重開 app，確認開關仍顯示為關閉（用戶設定被保留）**

關閉 app，重新啟動，進入「顯示工具」面板，確認 Switch 仍為關閉（`autostart_init` flag 已存在，不會再預設開啟）。

- [ ] **Step 6：最終 commit（若 Task 4 已分開 commit，此步跳過）**

確認 `git status` 乾淨。
