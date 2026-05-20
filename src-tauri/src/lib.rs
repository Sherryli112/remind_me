mod popup;
mod scheduler;
mod sidecar;
mod tray;

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Manager, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().build())
        .setup(|app| {
            let app_handle = app.handle().clone();

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
            }

            if let Some(w) = app_handle.get_webview_window("main") {
                w.show()?;
                w.set_focus()?;
            }

            tray::setup_tray(&app_handle)?;
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
