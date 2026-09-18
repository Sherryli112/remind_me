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
    // `reminders` is only this poll's newly-due batch, not "everything currently
    // pending" — merge instead of overwrite, or an earlier reminder the frontend
    // hasn't acknowledged yet (via acknowledge_reminder) would vanish from state
    // the moment a later, unrelated reminder fires.
    if let Some(state) = app.try_state::<PopupManagerState>() {
        let mut pending = state.pending.lock().unwrap();
        for r in reminders {
            if !pending.iter().any(|p| p.id == r.id) {
                pending.push(r.clone());
            }
        }
    }

    if reminders.is_empty() {
        // Don't hide on empty queue — frontend owns the hide decision
        // (it may still be showing reminders from a previous batch).
        // Frontend calls invoke('hide_popup') when its own reminders list empties.
        return;
    }

    let first = &reminders[0];
    let (width, init_height) = collapsed_size(&first.size, reminders.len());

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
            match WebviewWindowBuilder::new(app, LABEL, url)
                .title("")
                .decorations(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .resizable(false)
                .shadow(false)
                .transparent(true)
                // Intel 內顯（例如 UHD 770）在「透明視窗」這個組合下，WebView2 的 GPU
                // 合成路徑不穩定，會出現文字整個消失或殘留奇怪色塊等 artifact（微軟
                // WebView2Feedback #5492/#2986、Intel 官方社群都有同樣回報）。這兩個彈窗
                // 內容單純、不需要 GPU 加速，直接關掉 GPU 合成繞開整個問題。
                // 只用 additional_browser_args 會整個蓋掉 wry 預設帶的 flag，所以要
                // 手動把預設值也一併帶上（wry 文件註明的預設值）。
                .additional_browser_args(
                    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --disable-gpu",
                )
                .inner_size(width, init_height)
                .position(x, y)
                .visible(false)
                .build()
            {
                Ok(w) => {
                    #[cfg(target_os = "windows")]
                    remove_dwm_border(&w);
                    w
                }
                Err(e) => {
                    eprintln!("popup-manager: window creation failed: {e}");
                    return;
                }
            }
        }
    };

    // 不在這裡 show() — 視窗建立後到前端量測完內容、呼叫 resize_popup 之間有個空檔，
    // 先讓前端把尺寸算對、resize 完再呼叫 invoke('show_popup')，避免使用者看到
    // 中途尺寸不對的過渡狀態。
    let _ = window.emit("reminders-updated", reminders);
}

/// Windows 11 會幫每個頂層視窗畫圓角，就算 `decorations(false)` 也一樣，是 DWM
/// 的合成效果、不是 WebView2/CSS 能控制的層面。在這種透明、自訂形狀的彈窗上
/// 會跟卡片自己的 CSS 圓角打架，所以關掉讓 Windows 完全不要插手視窗外框。
#[cfg(target_os = "windows")]
fn remove_dwm_border(window: &tauri::WebviewWindow) {
    use windows_sys::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_WINDOW_CORNER_PREFERENCE,
        DWMWCP_DONOTROUND, DWMWA_COLOR_NONE,
    };
    let Ok(hwnd) = window.hwnd() else { return };
    unsafe {
        let corner_pref: u32 = DWMWCP_DONOTROUND as u32;
        let _ = DwmSetWindowAttribute(
            hwnd.0 as _,
            DWMWA_WINDOW_CORNER_PREFERENCE as u32,
            &corner_pref as *const u32 as *const std::ffi::c_void,
            std::mem::size_of::<u32>() as u32,
        );
        let border_color: u32 = DWMWA_COLOR_NONE as u32;
        let _ = DwmSetWindowAttribute(
            hwnd.0 as _,
            DWMWA_BORDER_COLOR as u32,
            &border_color as *const u32 as *const std::ffi::c_void,
            std::mem::size_of::<u32>() as u32,
        );
    }
}

/// Initial height for the collapsed state — must match the frontend's
/// calcWindowHeight() (height.ts) exactly. The window is shown before the
/// frontend gets a chance to call resize_popup, so any mismatch here shows
/// up as a transparent gap that briefly exposes the desktop underneath until
/// the frontend corrects it. Arrow space is only reserved when there's a
/// second card to peek at.
fn collapsed_size(size: &str, count: usize) -> (f64, f64) {
    let (w, card_h) = card_size(size);
    let arrow_space = if count > 1 { 20.0 } else { 0.0 };
    (w, card_h + arrow_space + 8.0)
}
