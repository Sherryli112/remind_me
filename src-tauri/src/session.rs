// src-tauri/src/session.rs
//
// 前端登入後透過 set_session 把 access token 與裝置 ID 交給 Rust，scheduler.rs 輪詢
// /scheduler/due 時要帶上這兩個 header。前端在登入、啟動、每次 refresh 成功後都會呼叫
// set_session；登出時呼叫 clear_session。沒有 session 時輪詢器直接跳過這一輪。

use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, Debug)]
pub struct Session {
    pub access_token: String,
    pub device_id: String,
}

#[derive(Default)]
struct SessionInner {
    session: Option<Session>,
    /// 已經因為 401 發過 session-expired 的 token——同一個 token 只通知主視窗一次，
    /// 不然 refresh 還沒回來之前每 3 秒輪詢都會再發一次。
    expired_notified_for: Option<String>,
}

#[derive(Default)]
pub struct SessionState(Mutex<SessionInner>);

impl SessionState {
    pub fn current(&self) -> Option<Session> {
        self.0.lock().unwrap().session.clone()
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
}

#[tauri::command]
pub fn set_session(
    access_token: String,
    device_id: String,
    state: tauri::State<'_, SessionState>,
) -> Result<(), String> {
    if access_token.is_empty() || device_id.is_empty() {
        return Err("access_token 與 device_id 不可為空".to_string());
    }
    let mut inner = state.0.lock().unwrap();
    inner.session = Some(Session {
        access_token,
        device_id,
    });
    Ok(())
}

#[tauri::command]
pub fn clear_session(app: AppHandle, state: tauri::State<'_, SessionState>) -> Result<(), String> {
    {
        let mut inner = state.0.lock().unwrap();
        inner.session = None;
        inner.expired_notified_for = None;
    }
    // 換帳號登入時不要再顯示上一個帳號還沒處理的提醒
    if let Some(popup_state) = app.try_state::<crate::popup_manager::PopupManagerState>() {
        popup_state.pending.lock().unwrap().clear();
    }
    let _ = app.emit("session-cleared", ());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state_with(token: &str) -> SessionState {
        let state = SessionState::default();
        state.0.lock().unwrap().session = Some(Session {
            access_token: token.to_string(),
            device_id: "device-1".to_string(),
        });
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
        state.0.lock().unwrap().session = Some(Session {
            access_token: "t2".to_string(),
            device_id: "device-1".to_string(),
        });
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
}
