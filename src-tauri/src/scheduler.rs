use crate::popup::DueReminder;
use crate::popup_manager;
use std::time::Duration;
use tauri::AppHandle;

pub fn start_polling(app: AppHandle, api_base_url: String) {
    std::thread::spawn(move || {
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap();
        let due_url = format!("{api_base_url}/scheduler/due");

        loop {
            std::thread::sleep(Duration::from_secs(3));

            match client
                .get(&due_url)
                .send()
                .and_then(|r| r.json::<Vec<DueReminder>>())
            {
                Ok(reminders) => {
                    if !reminders.is_empty() {
                        eprintln!("[scheduler] 輪詢到 {} 則到期提醒", reminders.len());
                    }
                    popup_manager::show_reminders(&app, &reminders);
                }
                Err(e) => eprintln!("輪詢 /scheduler/due 失敗: {e}"),
            }
        }
    });
}
