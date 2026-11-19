use serde::{Deserialize, Serialize};
use tauri::AppHandle;

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
#[derive(Deserialize, Serialize, Debug, Clone)]
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
        "small" => (220.0, 113.0),
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
    let available_names: Vec<Option<String>> = app
        .available_monitors()
        .ok()
        .into_iter()
        .flatten()
        .map(|m| m.name().cloned())
        .collect();
    eprintln!(
        "[calc_popup_position] requested target_screen_id={target_screen_id:?} available_monitor_names={available_names:?}"
    );

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
    eprintln!(
        "[calc_popup_position] picked monitor name={:?} position={:?}",
        monitor.name(),
        monitor.position()
    );
    let scale = monitor.scale_factor();
    let margin = 16.0;

    // Use work area (excludes taskbar/dock) so bottom-corner popups sit above the taskbar.
    #[cfg(target_os = "windows")]
    let (work_x, work_y, work_w, work_h) = monitor_work_area(
        monitor.position().x,
        monitor.position().y,
        scale,
    );
    // macOS / Linux：Tauri 的 Monitor::work_area() 在 macOS 取 NSScreen.visibleFrame
    // （扣掉上方選單列與 Dock，Dock 放左右兩側也會扣），Linux 取 GDK workarea。
    // 以前這裡直接用整個螢幕，右下角的彈窗會被 Dock 蓋住、左上角的會壓到選單列。
    #[cfg(not(target_os = "windows"))]
    let (work_x, work_y, work_w, work_h) = {
        let area = monitor.work_area();
        (
            area.position.x as f64 / scale,
            area.position.y as f64 / scale,
            area.size.width as f64 / scale,
            area.size.height as f64 / scale,
        )
    };

    match corner {
        "top_left"    => (work_x + margin,                    work_y + margin),
        "top_right"   => (work_x + work_w - width - margin,   work_y + margin),
        "bottom_left" => (work_x + margin,                    work_y + work_h - height - margin),
        _             => (work_x + work_w - width - margin,   work_y + work_h - height - margin),
    }
}
