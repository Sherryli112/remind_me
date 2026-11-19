use crate::popup::DueReminder;
use crate::popup_manager;
use crate::session::SessionState;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

pub fn start_polling(app: AppHandle, api_base_url: &str) {
    let due_url = format!("{api_base_url}/scheduler/due");
    std::thread::spawn(move || {
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap();

        loop {
            std::thread::sleep(Duration::from_secs(3));

            // 還沒登入（或已登出）就跳過這一輪，等前端呼叫 set_session
            let Some(session) = app.try_state::<SessionState>().and_then(|s| s.current()) else {
                continue;
            };

            let response = match client
                .get(&due_url)
                .bearer_auth(&session.access_token)
                .header("X-Device-Id", &session.device_id)
                .send()
            {
                Ok(r) => r,
                Err(e) => {
                    eprintln!("輪詢 /scheduler/due 失敗: {e}");
                    continue;
                }
            };

            if response.status() == reqwest::StatusCode::UNAUTHORIZED {
                // access token 過期：請主視窗 refresh 後再呼叫 set_session。
                // 同一個 token 只通知一次，避免 refresh 回來前每 3 秒狂發事件。
                let should_notify = app
                    .try_state::<SessionState>()
                    .is_some_and(|s| s.mark_expired(&session.access_token));
                if should_notify {
                    eprintln!("[scheduler] access token 已失效，通知主視窗 refresh");
                    let _ = app.emit_to("main", "session-expired", ());
                }
                continue;
            }

            if !response.status().is_success() {
                eprintln!("輪詢 /scheduler/due 失敗: HTTP {}", response.status());
                continue;
            }

            match response.json::<Vec<DueReminder>>() {
                Ok(reminders) => {
                    if !reminders.is_empty() {
                        eprintln!("[scheduler] 輪詢到 {} 則到期提醒", reminders.len());
                    }
                    popup_manager::show_reminders(&app, &reminders);
                }
                Err(e) => eprintln!("解析 /scheduler/due 回應失敗: {e}"),
            }
        }
    });
}
