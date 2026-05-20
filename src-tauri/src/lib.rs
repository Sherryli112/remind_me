mod popup;
mod scheduler;
mod sidecar;
mod tray;

use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Manager, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().build())
        .setup(|app| {
            let app_handle = app.handle().clone();

            let exe_dir = std::env::current_exe()
                .map(|p| p.parent().unwrap().to_path_buf())
                .unwrap_or_else(|_| PathBuf::from("."));

            let backend_dir = if cfg!(debug_assertions) {
                // dev: exe 在 src-tauri/target/debug/app.exe，backend 在 ../../../backend
                exe_dir
                    .join("..")
                    .join("..")
                    .join("..")
                    .join("backend")
                    .canonicalize()
                    .unwrap_or_else(|_| exe_dir.join("backend"))
            } else {
                exe_dir.join("backend")
            };

            let db_path = if cfg!(debug_assertions) {
                backend_dir
                    .join("data")
                    .join("remindme.db")
                    .to_string_lossy()
                    .to_string()
            } else {
                let data_dir = app_handle
                    .path()
                    .app_data_dir()
                    .expect("no app data dir");
                std::fs::create_dir_all(&data_dir).ok();
                data_dir.join("remindme.db").to_string_lossy().to_string()
            };

            let sidecar = sidecar::NestjsSidecar::spawn(backend_dir, db_path)
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

            if let Some(w) = app_handle.get_webview_window("main") {
                w.show()?;
                w.set_focus()?;
            }

            tray::setup_tray(&app_handle)?;

            app_handle.manage(Mutex::new(sidecar));

            scheduler::start_polling(app_handle);

            Ok(())
        })
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
