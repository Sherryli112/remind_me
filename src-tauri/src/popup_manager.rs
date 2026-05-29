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
            match WebviewWindowBuilder::new(app, LABEL, url)
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
            {
                Ok(w) => w,
                Err(e) => {
                    eprintln!("popup-manager: window creation failed: {e}");
                    return;
                }
            }
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
