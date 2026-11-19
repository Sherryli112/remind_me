mod popup;
mod popup_manager;
mod scheduler;
mod session;
mod tray;

use std::sync::Mutex;
use crate::popup::calc_popup_position;
use tauri::{Manager, WindowEvent};
use tauri_plugin_autostart::ManagerExt;

/// 雲端 API 位址在「編譯時」決定：release build 設定環境變數 REMINDME_API_BASE_URL，
/// 跟前端的 NEXT_PUBLIC_API_BASE_URL 指向同一個網址；沒設就打本機開發用後端。
fn api_base_url() -> &'static str {
    option_env!("REMINDME_API_BASE_URL")
        .filter(|v| !v.is_empty())
        .unwrap_or("http://localhost:3000")
        .trim_end_matches('/')
}

#[tauri::command]
fn get_autostart(app: tauri::AppHandle) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
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

#[tauri::command]
fn get_pending_reminders(
    state: tauri::State<'_, popup_manager::PopupManagerState>,
) -> Vec<popup::DueReminder> {
    state.pending.lock().unwrap().clone()
}

/// 前端延後/關閉一則提醒後呼叫這個，把它從 pending 移除——避免 get_pending_reminders
/// 在視窗重新載入時，把已經處理過的提醒又拿出來重新顯示一次。
#[tauri::command]
fn acknowledge_reminder(
    id: String,
    state: tauri::State<'_, popup_manager::PopupManagerState>,
) -> Result<(), String> {
    state.pending.lock().unwrap().retain(|r| r.id != id);
    Ok(())
}

#[tauri::command]
fn resize_popup(
    app: tauri::AppHandle,
    width: f64,
    height: f64,
    corner: String,
    target_screen_id: Option<String>,
) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("popup-manager") {
        let (x, y) = calc_popup_position(&app, width, height, &corner, target_screen_id.as_deref());
        window.set_size(tauri::LogicalSize::new(width, height)).map_err(|e| e.to_string())?;
        // 已知 Tauri/WebView2 在 Windows 11 上的問題：透明視窗 resize 後，尺寸差異的
        // 那塊區域殘留白色像素、沒有正確清成透明（tauri-apps/tauri#10318）。
        // 微調一次尺寸再立刻改回來，強制 WebView2 完整重繪一次來清掉殘影。
        #[cfg(target_os = "windows")]
        {
            let _ = window.set_size(tauri::LogicalSize::new(width + 1.0, height + 1.0));
            let _ = window.set_size(tauri::LogicalSize::new(width, height));
        }
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

#[tauri::command]
fn show_popup(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("popup-manager") {
        w.show().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 必須是第一個註冊的 plugin：偵測到第二個實例啟動時，把既有視窗顯示並取得焦點，
        // 而不是讓第二個實例繼續啟動（會出現兩個常駐列圖示，以及兩組輪詢器各自向雲端
        // 拉取同一台裝置的到期提醒）。
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_log::Builder::default().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(session::SessionState::default())
        .setup(|app| {
            let app_handle = app.handle().clone();

            if let Some(w) = app_handle.get_webview_window("main") {
                w.show()?;
                w.set_focus()?;
            }

            tray::setup_tray(&app_handle)?;
            app.manage(popup_manager::PopupManagerState {
                pending: Mutex::new(Vec::new()),
            });
            // 輪詢器在拿到 session（前端登入後呼叫 set_session）之前會自動跳過每一輪
            scheduler::start_polling(app_handle.clone(), api_base_url());

            // 以前是內附的本機後端啟動時順便建立 app data 目錄；現在要自己建，不然旗標檔寫不進去，
            // 每次啟動都會重新啟用開機自動啟動、蓋掉使用者手動關閉的設定
            let data_dir = app_handle.path().app_data_dir().expect("no app data dir");
            let _ = std::fs::create_dir_all(&data_dir);
            let init_flag = data_dir.join("autostart_init");
            if !init_flag.exists() {
                if app_handle.autolaunch().enable().is_ok() {
                    let _ = std::fs::write(&init_flag, "");
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            session::set_session,
            session::clear_session,
            get_autostart,
            set_autostart,
            get_pending_reminders,
            acknowledge_reminder,
            resize_popup,
            hide_popup,
            show_popup,
        ])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    window.hide().unwrap();
                    api.prevent_close();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
