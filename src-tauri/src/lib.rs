mod popup;
mod popup_manager;
mod scheduler;
mod sidecar;
mod tray;

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use crate::popup::calc_popup_position;
use tauri::{Manager, WindowEvent};
use tauri_plugin_autostart::ManagerExt;

/// Release 模式下後端 sidecar 用動態埠啟動，實際位址要等 sidecar 就緒後才知道；
/// 在那之前 get_api_base_url 回傳 Err，前端會輪詢重試。
pub struct ApiBaseUrl(Mutex<Option<String>>);

#[tauri::command]
fn get_api_base_url(state: tauri::State<'_, ApiBaseUrl>) -> Result<String, String> {
    state.0.lock().unwrap().clone().ok_or_else(|| "backend not ready".to_string())
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
        // 而不是讓第二個實例繼續啟動（會產生兩個 sidecar 搶同一份 SQLite）。
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
        .manage(ApiBaseUrl(Mutex::new(None)))
        .setup(|app| {
            let app_handle = app.handle().clone();
            let api_base_url: String;

            // dev 模式：後端由開發者自行啟動（npm run start:dev），只等待 /health
            // release 模式：啟動 NestJS sidecar
            #[cfg(not(debug_assertions))]
            {
                let exe_dir = std::env::current_exe()
                    .map(|p| p.parent().unwrap().to_path_buf())
                    .unwrap_or_else(|_| PathBuf::from("."));

                let backend_dir = exe_dir.join("backend");

                let data_dir = app_handle
                    .path()
                    .app_data_dir()
                    .expect("no app data dir");
                std::fs::create_dir_all(&data_dir).ok();
                let db_path = data_dir.join("remindme.db").to_string_lossy().replace('\\', "/");

                let sidecar = sidecar::NestjsSidecar::spawn(backend_dir, db_path, exe_dir)
                    .map_err(|e| {
                        eprintln!("NestJS 啟動失敗: {e}");
                        Box::new(std::io::Error::new(std::io::ErrorKind::Other, e))
                            as Box<dyn std::error::Error>
                    })?;

                eprint!("等待後端啟動");
                if !sidecar.wait_until_ready() {
                    eprintln!("\n後端未能在 30 秒內就緒");
                    return Err(Box::new(std::io::Error::new(
                        std::io::ErrorKind::TimedOut,
                        "backend timeout",
                    )));
                }
                eprintln!(" ✓");
                let port = sidecar.port().expect("port should be known once ready");
                api_base_url = format!("http://localhost:{port}");
                app_handle.manage(Mutex::new(sidecar));
            }

            // dev 模式：等待已在外部啟動的後端（最多 60 秒）
            #[cfg(debug_assertions)]
            {
                let _ = PathBuf::from("."); // suppress unused import warning
                eprintln!("dev 模式：等待 http://localhost:3000/health ...");
                let client = reqwest::blocking::Client::builder()
                    .timeout(Duration::from_secs(2))
                    .build()
                    .unwrap();
                let mut ready = false;
                for _ in 0..60 {
                    if client
                        .get("http://localhost:3000/health")
                        .send()
                        .map(|r| r.status().is_success())
                        .unwrap_or(false)
                    {
                        ready = true;
                        break;
                    }
                    std::thread::sleep(Duration::from_secs(1));
                }
                if !ready {
                    eprintln!("後端未就緒，請先執行: cd backend && npm run start:dev");
                    return Err(Box::new(std::io::Error::new(
                        std::io::ErrorKind::TimedOut,
                        "backend not running",
                    )));
                }
                eprintln!("後端已就緒 ✓");
                api_base_url = "http://localhost:3000".to_string();
            }

            if let Some(state) = app_handle.try_state::<ApiBaseUrl>() {
                *state.0.lock().unwrap() = Some(api_base_url.clone());
            }

            if let Some(w) = app_handle.get_webview_window("main") {
                w.show()?;
                w.set_focus()?;
            }

            tray::setup_tray(&app_handle)?;
            app.manage(popup_manager::PopupManagerState {
                pending: Mutex::new(Vec::new()),
            });
            scheduler::start_polling(app_handle.clone(), api_base_url);

            let init_flag = app_handle
                .path()
                .app_data_dir()
                .expect("no app data dir")
                .join("autostart_init");
            if !init_flag.exists() {
                if app_handle.autolaunch().enable().is_ok() {
                    let _ = std::fs::write(&init_flag, "");
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_api_base_url,
            get_autostart,
            set_autostart,
            get_pending_reminders,
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
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(sidecar) =
                    app.try_state::<Mutex<sidecar::NestjsSidecar>>()
                {
                    sidecar.lock().unwrap().kill();
                }
            }
        });
}
