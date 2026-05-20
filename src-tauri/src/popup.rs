use serde::Deserialize;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

#[derive(Deserialize, Debug, Clone)]
pub struct DueReminder {
    pub id: String,
    pub title: String,
    pub content: String,
    #[serde(rename = "autoCloseEnabled")]
    pub auto_close_enabled: bool,
    #[serde(rename = "autoCloseSeconds")]
    pub auto_close_seconds: i64,
    #[serde(rename = "snoozeDefaultSeconds")]
    pub snooze_default_seconds: i64,
    pub corner: String,
    pub size: String,
}

pub fn open_popup(app: &AppHandle, reminder: &DueReminder) -> Result<(), tauri::Error> {
    let label = format!("popup-{}", &reminder.id[..8]);

    if app.get_webview_window(&label).is_some() {
        return Ok(());
    }

    let (width, height): (f64, f64) = match reminder.size.as_str() {
        "small" => (280.0, 140.0),
        "large" => (360.0, 200.0),
        _ => (320.0, 170.0),
    };

    let monitor = app
        .primary_monitor()
        .ok()
        .flatten()
        .expect("No monitor found");
    let screen_w = monitor.size().width as f64 / monitor.scale_factor();
    let screen_h = monitor.size().height as f64 / monitor.scale_factor();
    let margin = 16.0;

    let (x, y) = match reminder.corner.as_str() {
        "top_left" => (margin, margin),
        "top_right" => (screen_w - width - margin, margin),
        "bottom_left" => (margin, screen_h - height - margin),
        _ => (screen_w - width - margin, screen_h - height - margin),
    };

    let port = if cfg!(debug_assertions) { 3001 } else { 3000 };
    let url = format!("http://localhost:{}/popup/{}", port, reminder.id);

    WebviewWindowBuilder::new(app, label, WebviewUrl::External(url.parse().unwrap()))
        .title("")
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .inner_size(width, height)
        .position(x, y)
        .transparent(true)
        .visible(true)
        .build()?;

    Ok(())
}
