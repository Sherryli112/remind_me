// src-tauri/src/session.rs
//
// App 任何時刻只有一種模式，由這裡的 session 決定：
// - 雲端模式：有 session。前端登入後透過 set_session 把 access token 與裝置 ID 交給 Rust，
//   scheduler.rs 輪詢 /scheduler/due 時要帶上這兩個 header。前端在登入、啟動、每次 refresh
//   成功後都會呼叫 set_session。
// - 本機模式：沒有 session。資料讀寫本機 SQLite（local_api.rs），排程由 local_scheduler.rs 負責。
//
// 前端（主視窗）啟動時一定會呼叫一次 set_session 或 clear_session 回報模式；在那之前兩個排程器
// 都不跑，避免「其實有登入、只是前端還沒載入完」的那幾秒誤觸發本機提醒。
//
// 模式真的改變時（沒有 session ↔ 有 session）：清掉待顯示的彈窗，並 broadcast `mode-changed`
// （payload `"local"` 或 `"cloud"`），所有視窗重新載入資料。同模式內的呼叫（refresh 後換 token、
// 本機模式下重新載入主視窗）不發事件。

use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, Debug)]
pub struct Session {
    pub access_token: String,
    pub device_id: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Local,
    Cloud,
}

#[derive(Default)]
struct SessionInner {
    session: Option<Session>,
    /// 已經因為 401 發過 session-expired 的 token——同一個 token 只通知主視窗一次，
    /// 不然 refresh 還沒回來之前每 3 秒輪詢都會再發一次。
    expired_notified_for: Option<String>,
    /// 前端是否已經回報過模式（呼叫過 set_session 或 clear_session）
    reported: bool,
}

#[derive(Default)]
pub struct SessionState(Mutex<SessionInner>);

impl SessionState {
    pub fn current(&self) -> Option<Session> {
        self.0.lock().unwrap().session.clone()
    }

    /// 本機排程器要不要跑：前端回報過模式、而且沒有 session。
    pub fn is_local_mode(&self) -> bool {
        let inner = self.0.lock().unwrap();
        inner.reported && inner.session.is_none()
    }

    /// 輪詢收到 401 時呼叫。回傳 true 代表這個 token 第一次被拒絕，應該通知主視窗。
    /// 若 session 已經被換成別的 token（前端剛 refresh 完）就不需要通知。
    pub fn mark_expired(&self, access_token: &str) -> bool {
        let mut inner = self.0.lock().unwrap();
        let is_current = inner
            .session
            .as_ref()
            .is_some_and(|s| s.access_token == access_token);
        if !is_current || inner.expired_notified_for.as_deref() == Some(access_token) {
            return false;
        }
        inner.expired_notified_for = Some(access_token.to_string());
        true
    }

    /// 設定 session。回傳 Some(Mode::Cloud) 代表模式從本機切到雲端
    /// （啟動時第一次回報就是雲端模式不算切換）。
    fn set(&self, session: Session) -> Option<Mode> {
        let mut inner = self.0.lock().unwrap();
        let was_local = inner.reported && inner.session.is_none();
        inner.session = Some(session);
        inner.reported = true;
        was_local.then_some(Mode::Cloud)
    }

    /// 清除 session。回傳 Some(Mode::Local) 代表模式從雲端切到本機。
    fn clear(&self) -> Option<Mode> {
        let mut inner = self.0.lock().unwrap();
        let was_cloud = inner.session.is_some();
        inner.session = None;
        inner.expired_notified_for = None;
        inner.reported = true;
        was_cloud.then_some(Mode::Local)
    }
}

/// 模式切換：上一個模式的提醒不該留在畫面上（登入後不顯示本機提醒、登出 / 換帳號後
/// 不顯示上一個帳號的提醒），所以清掉 pending，再通知所有視窗。
fn on_mode_changed(app: &AppHandle, mode: Mode) {
    if let Some(popup_state) = app.try_state::<crate::popup_manager::PopupManagerState>() {
        popup_state.pending.lock().unwrap().clear();
    }
    log::info!("[session] 切換到{}模式", if mode == Mode::Cloud { "雲端" } else { "本機" });
    let _ = app.emit("mode-changed", mode);
}

#[tauri::command]
pub fn set_session(
    app: AppHandle,
    access_token: String,
    device_id: String,
    state: tauri::State<'_, SessionState>,
) -> Result<(), String> {
    if access_token.is_empty() || device_id.is_empty() {
        return Err("access_token 與 device_id 不可為空".to_string());
    }
    if let Some(mode) = state.set(Session {
        access_token,
        device_id,
    }) {
        on_mode_changed(&app, mode);
    }
    Ok(())
}

#[tauri::command]
pub fn clear_session(app: AppHandle, state: tauri::State<'_, SessionState>) -> Result<(), String> {
    if let Some(mode) = state.clear() {
        // 舊的事件名稱保留給還在監聽它的視窗
        let _ = app.emit("session-cleared", ());
        on_mode_changed(&app, mode);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session(token: &str) -> Session {
        Session {
            access_token: token.to_string(),
            device_id: "device-1".to_string(),
        }
    }

    fn state_with(token: &str) -> SessionState {
        let state = SessionState::default();
        state.set(session(token));
        state
    }

    #[test]
    fn expired_is_notified_once_per_token() {
        let state = state_with("t1");
        assert!(state.mark_expired("t1"));
        assert!(!state.mark_expired("t1"));
    }

    #[test]
    fn new_token_can_be_notified_again() {
        let state = state_with("t1");
        assert!(state.mark_expired("t1"));
        state.set(session("t2"));
        assert!(state.mark_expired("t2"));
    }

    #[test]
    fn stale_token_is_not_notified() {
        // 輪詢送出後前端剛好 refresh 完換了新 token，舊 token 的 401 不用再通知
        let state = state_with("t2");
        assert!(!state.mark_expired("t1"));
        assert!(SessionState::default().current().is_none());
        assert!(!SessionState::default().mark_expired("t1"));
    }

    #[test]
    fn local_mode_requires_frontend_report() {
        // 前端還沒回報前，兩種排程器都不跑
        let state = SessionState::default();
        assert!(!state.is_local_mode());
        assert!(state.current().is_none());
        // 主視窗沒有登入 → clear_session：進入本機模式，但模式沒有「切換」（不發事件）
        assert_eq!(state.clear(), None);
        assert!(state.is_local_mode());
    }

    #[test]
    fn startup_with_session_is_not_a_transition() {
        let state = SessionState::default();
        assert_eq!(state.set(session("t1")), None);
        assert!(!state.is_local_mode());
    }

    #[test]
    fn mode_transitions_are_reported_once() {
        let state = SessionState::default();
        assert_eq!(state.clear(), None);
        assert_eq!(state.set(session("t1")), Some(Mode::Cloud));
        assert!(!state.is_local_mode());
        // refresh 換 token：還是雲端模式
        assert_eq!(state.set(session("t2")), None);
        assert_eq!(state.clear(), Some(Mode::Local));
        assert!(state.is_local_mode());
        // 本機模式下主視窗重新載入又呼叫 clear_session：不再發事件
        assert_eq!(state.clear(), None);
    }

    #[test]
    fn mode_serializes_as_lowercase_string() {
        assert_eq!(serde_json::to_value(Mode::Local).unwrap(), "local");
        assert_eq!(serde_json::to_value(Mode::Cloud).unwrap(), "cloud");
    }
}
