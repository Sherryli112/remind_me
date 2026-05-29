use serde::Deserialize;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// Returns (x, y, width, height) of the work area (screen minus taskbar) in logical pixels.
/// Falls back to full monitor dimensions if the platform call fails.
#[cfg(target_os = "windows")]
fn monitor_work_area(phys_x: i32, phys_y: i32, scale: f64) -> (f64, f64, f64, f64) {
    use windows_sys::Win32::Foundation::POINT;
    use windows_sys::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    let pt = POINT { x: phys_x, y: phys_y };
    let hmon = unsafe { MonitorFromPoint(pt, MONITOR_DEFAULTTONEAREST) };
    let mut info = MONITORINFO {
        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
        rcMonitor: unsafe { std::mem::zeroed() },
        rcWork: unsafe { std::mem::zeroed() },
        dwFlags: 0,
    };
    let ok = unsafe { GetMonitorInfoW(hmon, &mut info) };
    if ok == 0 {
        let full = info.rcMonitor;
        return (
            full.left as f64 / scale,
            full.top as f64 / scale,
            (full.right - full.left) as f64 / scale,
            (full.bottom - full.top) as f64 / scale,
        );
    }
    let rc = info.rcWork;
    (
        rc.left as f64 / scale,
        rc.top as f64 / scale,
        (rc.right - rc.left) as f64 / scale,
        (rc.bottom - rc.top) as f64 / scale,
    )
}

#[allow(dead_code)]
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
    #[serde(rename = "targetScreenId")]
    pub target_screen_id: Option<String>,
}

pub(crate) fn card_size(size: &str) -> (f64, f64) {
    match size {
        "small" => (220.0, 105.0),
        "large" => (310.0, 160.0),
        _ => (265.0, 130.0),
    }
}

pub(crate) fn calc_popup_position(
    app: &AppHandle,
    width: f64,
    height: f64,
    corner: &str,
    target_screen_id: Option<&str>,
) -> (f64, f64) {
    let monitor = target_screen_id
        .and_then(|name| {
            app.available_monitors()
                .ok()
                .into_iter()
                .flatten()
                .find(|m| m.name().is_some_and(|n| n == name))
        })
        .or_else(|| app.primary_monitor().ok().flatten())
        .expect("No monitor found");
    let scale = monitor.scale_factor();
    let margin = 16.0;

    // Use work area (excludes taskbar/dock) so bottom-corner popups sit above the taskbar.
    // On non-Windows platforms fall back to the full monitor rect.
    #[cfg(target_os = "windows")]
    let (work_x, work_y, work_w, work_h) = monitor_work_area(
        monitor.position().x,
        monitor.position().y,
        scale,
    );
    #[cfg(not(target_os = "windows"))]
    let (work_x, work_y, work_w, work_h) = {
        let x = monitor.position().x as f64 / scale;
        let y = monitor.position().y as f64 / scale;
        let w = monitor.size().width as f64 / scale;
        let h = monitor.size().height as f64 / scale;
        (x, y, w, h)
    };

    match corner {
        "top_left"    => (work_x + margin,                    work_y + margin),
        "top_right"   => (work_x + work_w - width - margin,   work_y + margin),
        "bottom_left" => (work_x + margin,                    work_y + work_h - height - margin),
        _             => (work_x + work_w - width - margin,   work_y + work_h - height - margin),
    }
}

pub fn open_popup(app: &AppHandle, reminder: &DueReminder) -> Result<(), tauri::Error> {
    let label = format!("popup-{}", &reminder.id[..8]);

    if app.get_webview_window(&label).is_some() {
        return Ok(());
    }

    let (width, height) = card_size(&reminder.size);
    let (x, y) = calc_popup_position(
        app,
        width,
        height,
        &reminder.corner,
        reminder.target_screen_id.as_deref(),
    );

    // WebviewUrl::App resolves against devUrl in dev mode and the bundled
    // frontendDist (tauri://localhost) in production — no hardcoded port needed.
    let url = WebviewUrl::App(format!("popup?id={}", reminder.id).into());

    WebviewWindowBuilder::new(app, label, url)
        .title("")
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .inner_size(width, height)
        .position(x, y)
        .visible(true)
        .build()?;

    Ok(())
}
