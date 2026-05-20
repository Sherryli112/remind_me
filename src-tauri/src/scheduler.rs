use crate::popup::{open_popup, DueReminder};
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
                    for reminder in &reminders {
                        if let Err(e) = open_popup(&app, reminder) {
                            eprintln!("開 popup 失敗: {e}");
                        }
                    }
                }
                Err(e) => eprintln!("輪詢 /scheduler/due 失敗: {e}"),
            }
        }
    });
}
