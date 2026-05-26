# 開機自啟功能設計

**日期**：2026-05-26  
**狀態**：已核准

## 目標

讓 RemindMe 預設在開機時自動啟動，確保提醒功能在重開機後仍持續運作。使用者可在「顯示工具」面板關閉此行為。

## 技術選型

使用 `tauri-plugin-autostart`（Tauri 官方插件）。此插件在 Windows 上操作 `HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Run` 登錄檔，並透過統一 API 曝露啟用/停用功能。

## 架構

### Rust 側（`src-tauri`）

**`Cargo.toml`**  
新增依賴：
```toml
tauri-plugin-autostart = "2"
```

**`lib.rs`**

1. 在 `tauri::Builder` 鏈結中加入：
   ```rust
   .plugin(tauri_plugin_autostart::init(
       tauri_plugin_autostart::MacosLauncher::LaunchAgent,
       Some(vec![]),
   ))
   ```
2. 在 `setup` 中加入首次啟動預設啟用邏輯（見下）
3. 新增兩個 Tauri 指令：
   - `get_autostart() -> bool`
   - `set_autostart(enabled: bool) -> ()`

**`capabilities/default.json`**  
新增 autostart 相關 capability 權限。

### 首次啟動預設啟用邏輯

```
啟動時（在 setup 最後執行）：
  init_flag = app_data_dir / "autostart_init"
  if !init_flag.exists():
    autolaunch_manager.enable()
    write(init_flag)
```

標記檔案只建立一次，確保：
- 首次安裝：自動啟用開機自啟
- 用戶主動關閉後重開機：不會被蓋回啟用

### Frontend 側（`DisplayPanel.tsx`）

在面板最下方新增「應用程式設定」區塊：

```
─────────────────────────────
應用程式設定
  [Switch] 開機時自動啟動
─────────────────────────────
```

- **mount 時**：`invoke("get_autostart")` 讀取當前狀態初始化 Switch
- **切換時**：`invoke("set_autostart", { enabled })` 寫入 OS

## 資料流

```
UI Switch 切換
  → invoke("set_autostart", { enabled })
  → Rust 指令呼叫 AutoLaunchManager::enable() / disable()
  → 寫入 Windows 登錄檔

UI 初始化
  → invoke("get_autostart")
  → Rust 指令呼叫 AutoLaunchManager::is_enabled()
  → 回傳 bool → 設定 Switch 初始狀態
```

## 邊界情況

- **invoke 失敗**：顯示錯誤提示（與現有 `setMessage` 機制一致），Switch 回復前一狀態
- **非 Windows 環境**：plugin 在 macOS 使用 LaunchAgent，行為相同；Linux 使用 systemd/XDG autostart
- **解安裝**：登錄檔項目不會自動清除（Tauri bundle 安裝程式負責清理）

## 修改範圍

| 檔案 | 變更類型 |
|------|---------|
| `src-tauri/Cargo.toml` | 新增依賴 |
| `src-tauri/src/lib.rs` | 註冊插件、加指令、首次啟動邏輯 |
| `src-tauri/capabilities/default.json` | 新增權限 |
| `frontend/src/components/DisplayPanel.tsx` | 新增設定區塊 + invoke |
