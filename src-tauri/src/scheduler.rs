use crate::popup::DueReminder;
use crate::popup_manager;
use std::time::Duration;
use tauri::AppHandle;

pub fn start_polling(app: AppHandle) {
    std::thread::spawn(move || {
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap();

        loop {
            std::thread::sleep(Duration::from_secs(30));

            match client
                .get("http://localhost:3000/scheduler/due")
                .send()
                .and_then(|r| r.json::<Vec<DueReminder>>())
            {
                Ok(reminders) => {
                    popup_manager::show_reminders(&app, &reminders);
                }
                Err(e) => eprintln!("輪詢 /scheduler/due 失敗: {e}"),
            }
        }
    });
}
