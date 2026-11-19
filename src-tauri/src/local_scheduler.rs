// src-tauri/src/local_scheduler.rs
//
// 本機模式的排程器：把 backend/src/scheduler/scheduler.service.ts 的判斷邏輯移植過來。
// 改規則時兩邊要一起改；backend/src/scheduler/scheduler.service.spec.ts 的案例在下面
// 的測試裡有一一對應的版本。
//
// 跟雲端版的差異：
// - 時區直接用作業系統的本地時間（chrono::Local），不需要帳號時區
// - 只有一個「使用者」、一台裝置，沒有裝置在線 / 佇列的概念：觸發後直接走跟雲端輪詢器
//   拿到 due 清單後同一條路（popup_manager::show_reminders）
// - 延後狀態（snoozeUntil）存在 DB，重開 App 不會遺失；firedSet 一樣放在記憶體
// - 只在本機模式（沒有 session）時執行

use crate::local_store::{self, LocalDb, LocalStore, ReminderFilter, ReminderRow, RuleRow};
use crate::popup::DueReminder;
use crate::popup_manager;
use crate::session::SessionState;
use chrono::{DateTime, Datelike, TimeZone, Timelike};
use rusqlite::params;
use std::time::Duration;
use tauri::{AppHandle, Manager};

/// firedSet 的紀錄只需要撐過觸發視窗（30 秒），保留 5 分鐘後清掉。
const FIRED_KEY_RETENTION_MS: i64 = 5 * 60 * 1000;
/// 觸發視窗：排定時間後 30 秒內都算到期（每 3 秒掃一次）。
const DUE_WINDOW_MS: i64 = 30_000;

/// 牆上時間各欄位（對應 backend/src/common/timezone.ts 的 ZonedParts）。
#[derive(Debug, Clone, Copy)]
struct ZonedParts {
    year: i32,
    month: u32,
    day: u32,
    hour: u32,
    minute: u32,
    second: u32,
    /// 0 = 週日 … 6 = 週六（與 JS Date#getDay 相同）
    week_day: u32,
}

fn zoned_parts<Tz: TimeZone>(now: &DateTime<Tz>) -> ZonedParts {
    ZonedParts {
        year: now.year(),
        month: now.month(),
        day: now.day(),
        hour: now.hour(),
        minute: now.minute(),
        second: now.second(),
        week_day: now.weekday().num_days_from_sunday(),
    }
}

/// 對應 JS 的 `value.split(':').map(Number)`：解析失敗是 NaN，後面的比較就一律不成立。
fn parse_hhmm(value: &str) -> (f64, f64) {
    fn js_number(s: Option<&str>) -> f64 {
        match s {
            None => f64::NAN,
            Some(s) => {
                let t = s.trim();
                if t.is_empty() {
                    0.0
                } else {
                    t.parse::<f64>().unwrap_or(f64::NAN)
                }
            }
        }
    }
    let mut parts = value.split(':');
    let h = js_number(parts.next());
    let m = js_number(parts.next());
    (h, m)
}

fn hhmm_minutes(value: &str) -> f64 {
    let (h, m) = parse_hhmm(value);
    h * 60.0 + m
}

/// 判斷某則提醒在 `now` 這個時間點是否到期。對應 SchedulerService.isReminderDue；
/// `now` 的時區就是使用者時區（本機模式傳 chrono::Local）。
pub fn is_reminder_due<Tz: TimeZone>(reminder: &ReminderRow, now: &DateTime<Tz>) -> bool {
    if !reminder.enabled {
        return false;
    }
    let now_ms = now.timestamp_millis();
    if let Some(end_at) = reminder.end_at {
        if now_ms > end_at {
            return false;
        }
    }

    if reminder.schedule_type == "one_time" {
        let Some(at) = reminder.one_time_at else {
            return false;
        };
        let diff = now_ms - at;
        return (0..=DUE_WINDOW_MS).contains(&diff);
    }

    let parts = zoned_parts(now);
    let ms_into_minute = parts.second as i64 * 1000 + now.timestamp_subsec_millis() as i64;
    reminder
        .rules
        .iter()
        .any(|rule| is_rule_due(rule, &parts, ms_into_minute))
}

fn is_rule_due(rule: &RuleRow, parts: &ZonedParts, ms_into_minute: i64) -> bool {
    let within_window = |(h, m): (f64, f64)| -> bool {
        parts.hour as f64 == h && parts.minute as f64 == m && ms_into_minute <= DUE_WINDOW_MS
    };
    let time_of_day = rule.time_of_day.as_deref().filter(|s| !s.is_empty());

    match rule.rule_mode.as_str() {
        "daily_time" => match time_of_day {
            Some(t) => within_window(parse_hhmm(t)),
            None => false,
        },
        "weekly_day" => {
            let Some(t) = time_of_day else { return false };
            if rule.week_days.is_empty() || !rule.week_days.contains(&(parts.week_day as i64)) {
                return false;
            }
            within_window(parse_hhmm(t))
        }
        "monthly_day" => {
            let Some(t) = time_of_day else { return false };
            let Some(day) = rule.month_day.filter(|d| *d != 0) else {
                return false;
            };
            if parts.day as i64 != day {
                return false;
            }
            within_window(parse_hhmm(t))
        }
        "interval" => {
            let Some(interval) = rule.interval_minutes.filter(|i| *i != 0) else {
                return false;
            };
            let now_min = (parts.hour * 60 + parts.minute) as f64;
            let active_from = rule.active_from.as_deref().filter(|s| !s.is_empty());
            let active_until = rule.active_until.as_deref().filter(|s| !s.is_empty());
            if active_from.is_some() || active_until.is_some() {
                let from_min = active_from.map(hhmm_minutes).unwrap_or(0.0);
                let until_min = active_until.map(hhmm_minutes).unwrap_or((24 * 60 - 1) as f64);
                if from_min <= until_min {
                    // 一般時間窗口
                    if now_min < from_min || now_min > until_min {
                        return false;
                    }
                } else if now_min > until_min && now_min < from_min {
                    // 跨午夜窗口（例如 23:30–01:00）：封鎖中間的空隙
                    return false;
                }
            }
            if !rule.week_days.is_empty() && !rule.week_days.contains(&(parts.week_day as i64)) {
                return false;
            }
            // 以 activeFrom 為錨點；未設時間窗口則從午夜 0:00 起算
            let anchor_min = active_from.map(hhmm_minutes).unwrap_or(0.0);
            // JS 的 % 跟 Rust 的 f64 % 一樣是截斷取餘數（結果與被除數同號）
            (now_min - anchor_min) % interval as f64 == 0.0 && parts.second <= 30
        }
        _ => false,
    }
}

fn window_key<Tz: TimeZone>(reminder: &ReminderRow, now: &DateTime<Tz>) -> String {
    if reminder.schedule_type == "one_time" {
        return "one_time".to_string();
    }
    let p = zoned_parts(now);
    format!(
        "{}-{:02}-{:02}-{:02}:{:02}",
        p.year, p.month, p.day, p.hour, p.minute
    )
}

/// 掃描一次，回傳這一輪新到期的提醒。對應 SchedulerService.checkDue（少了裝置佇列）。
pub fn check_due<Tz: TimeZone>(db: &mut LocalDb, now: &DateTime<Tz>) -> rusqlite::Result<Vec<DueReminder>> {
    let now_ms = now.timestamp_millis();
    db.fired
        .retain(|_, fired_at| now_ms - *fired_at <= FIRED_KEY_RETENTION_MS);

    let reminders = local_store::load_reminders(&db.conn, ReminderFilter::Enabled)?;
    if reminders.is_empty() {
        return Ok(Vec::new());
    }
    let display = local_store::load_display(&db.conn)?;
    // 與 DisplaySetting 預設值一致；還沒建立顯示設定時使用
    let (corner, size, target_screen_id) = match &display {
        Some(d) => (d.corner.clone(), d.size.clone(), d.target_screen_id.clone()),
        None => ("bottom_right".to_string(), "medium".to_string(), None),
    };

    let mut fired = Vec::new();
    // 因延後到期而觸發的不算新的一次，不計入 maxOccurrences
    let mut counted_ids: Vec<String> = Vec::new();

    for reminder in &reminders {
        let snooze_until = reminder.snooze_until;
        let snooze_expired = snooze_until.is_some_and(|until| now_ms >= until);

        if snooze_expired {
            // 延後時間到：不看排程，清掉延後狀態與舊的 firedSet，讓它不論排程視窗都能再跳一次
            db.conn.execute(
                r#"UPDATE "Reminder" SET "snoozeUntil" = NULL WHERE "id" = ?1"#,
                [&reminder.id],
            )?;
            db.clear_fired(&reminder.id);
        } else {
            if !is_reminder_due(reminder, now) {
                continue;
            }
            if snooze_until.is_some() {
                continue;
            }
        }

        let fired_key = format!("{}-{}", reminder.id, window_key(reminder, now));
        if db.fired.contains_key(&fired_key) {
            continue;
        }

        if let Some(max) = reminder.max_occurrences {
            if reminder.fire_count >= max {
                continue;
            }
        }

        db.fired.insert(fired_key, now_ms);
        if reminder.max_occurrences.is_some() && !snooze_expired {
            counted_ids.push(reminder.id.clone());
        }

        fired.push(DueReminder {
            id: reminder.id.clone(),
            title: reminder.title.clone(),
            content: reminder.content.clone(),
            auto_close_enabled: reminder.auto_close_enabled,
            auto_close_seconds: reminder.auto_close_seconds,
            snooze_default_seconds: reminder.snooze_default_seconds,
            corner: corner.clone(),
            size: size.clone(),
            target_screen_id: target_screen_id.clone(),
        });
    }

    // 持久化 fireCount，避免重啟後 maxOccurrences 計數歸零
    for id in &counted_ids {
        db.conn.execute(
            r#"UPDATE "Reminder" SET "fireCount" = "fireCount" + 1, "updatedAt" = ?2 WHERE "id" = ?1"#,
            params![id, now_ms],
        )?;
    }

    Ok(fired)
}

/// 每 3 秒掃一次本機提醒；有 session（雲端模式）或前端還沒回報模式時跳過。
pub fn start(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(3));

        let is_local = app
            .try_state::<SessionState>()
            .is_some_and(|s| s.is_local_mode());
        if !is_local {
            continue;
        }

        let due = {
            let Some(store) = app.try_state::<LocalStore>() else {
                continue;
            };
            let mut guard = store.0.lock().unwrap();
            let Some(db) = guard.as_mut() else { continue };
            match check_due(db, &chrono::Local::now()) {
                Ok(due) => due,
                Err(e) => {
                    log::error!("[local_scheduler] 掃描本機提醒失敗：{e}");
                    continue;
                }
            }
        };

        if !due.is_empty() {
            log::info!("[local_scheduler] {} 則本機提醒到期", due.len());
            popup_manager::show_reminders(&app, &due);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::local_store::{open_in_memory, GroupRow};
    use chrono::{FixedOffset, Utc};

    // ── 對應 scheduler.service.spec.ts 的輔助函式 ──────────────────────────

    fn tz(hours: i32) -> FixedOffset {
        FixedOffset::east_opt(hours * 3600).unwrap()
    }

    /// 台灣牆上時間（UTC+8）。月份為 1–12。
    fn tpe(y: i32, mo: u32, d: u32, h: u32, mi: u32, s: u32) -> DateTime<FixedOffset> {
        tz(8).with_ymd_and_hms(y, mo, d, h, mi, s).unwrap()
    }

    /// UTC 牆上時間（以 UTC 使用者的角度來看）。
    fn utc(y: i32, mo: u32, d: u32, h: u32, mi: u32, s: u32) -> DateTime<FixedOffset> {
        tz(0).with_ymd_and_hms(y, mo, d, h, mi, s).unwrap()
    }

    fn rule(mode: &str) -> RuleRow {
        RuleRow {
            id: "rule".into(),
            rule_mode: mode.into(),
            month_day: None,
            week_days: vec![],
            time_of_day: None,
            interval_minutes: None,
            active_from: None,
            active_until: None,
            reminder_id: "test-id".into(),
        }
    }

    fn daily(t: &str) -> RuleRow {
        RuleRow { time_of_day: Some(t.into()), ..rule("daily_time") }
    }

    fn weekly(days: &[i64], t: &str) -> RuleRow {
        RuleRow { time_of_day: Some(t.into()), week_days: days.to_vec(), ..rule("weekly_day") }
    }

    fn monthly(day: i64, t: &str) -> RuleRow {
        RuleRow { time_of_day: Some(t.into()), month_day: Some(day), ..rule("monthly_day") }
    }

    fn interval(mins: i64, from: Option<&str>, until: Option<&str>, days: &[i64]) -> RuleRow {
        RuleRow {
            interval_minutes: Some(mins),
            active_from: from.map(Into::into),
            active_until: until.map(Into::into),
            week_days: days.to_vec(),
            ..rule("interval")
        }
    }

    fn reminder(rules: Vec<RuleRow>) -> ReminderRow {
        ReminderRow {
            id: "test-id".into(),
            title: "title".into(),
            content: String::new(),
            enabled: true,
            schedule_type: "recurring".into(),
            one_time_at: None,
            auto_close_enabled: false,
            auto_close_seconds: 60,
            snooze_default_seconds: 300,
            sort_order: 0,
            end_at: None,
            max_occurrences: None,
            fire_count: 0,
            group_id: None,
            snooze_until: None,
            created_at: 0,
            updated_at: 0,
            rules,
            group: None::<GroupRow>,
        }
    }

    fn one_time(at: DateTime<FixedOffset>) -> ReminderRow {
        ReminderRow {
            schedule_type: "one_time".into(),
            one_time_at: Some(at.timestamp_millis()),
            ..reminder(vec![])
        }
    }

    // ── isReminderDue: one_time ─────────────────────────────────────────────

    #[test]
    fn one_time_triggers_within_past_30s() {
        let r = one_time(tpe(2026, 5, 20, 10, 0, 0));
        assert!(is_reminder_due(&r, &tpe(2026, 5, 20, 10, 0, 15)));
    }

    #[test]
    fn one_time_does_not_trigger_in_future() {
        let r = one_time(tpe(2026, 5, 20, 10, 1, 0));
        assert!(!is_reminder_due(&r, &tpe(2026, 5, 20, 10, 0, 0)));
    }

    #[test]
    fn one_time_does_not_trigger_after_30s() {
        let r = one_time(tpe(2026, 5, 20, 10, 0, 0));
        assert!(!is_reminder_due(&r, &tpe(2026, 5, 20, 10, 1, 0)));
    }

    #[test]
    fn one_time_is_absolute_regardless_of_timezone() {
        let r = one_time(utc(2026, 5, 20, 3, 0, 0));
        let now = utc(2026, 5, 20, 3, 0, 5);
        assert!(is_reminder_due(&r, &now.with_timezone(&tz(8))));
        assert!(is_reminder_due(&r, &now.with_timezone(&tz(-4))));
    }

    // ── daily_time ──────────────────────────────────────────────────────────

    #[test]
    fn daily_triggers_at_time() {
        let r = reminder(vec![daily("10:00")]);
        assert!(is_reminder_due(&r, &tpe(2026, 5, 20, 10, 0, 10)));
    }

    #[test]
    fn daily_does_not_trigger_31s_after() {
        let r = reminder(vec![daily("10:00")]);
        assert!(!is_reminder_due(&r, &tpe(2026, 5, 20, 10, 0, 31)));
    }

    #[test]
    fn daily_window_uses_milliseconds() {
        // msIntoMinute = 30_000 + 毫秒：30.000 秒還在視窗內，30.001 秒就超過
        let r = reminder(vec![daily("10:00")]);
        let base = tpe(2026, 5, 20, 10, 0, 30);
        assert!(is_reminder_due(&r, &base));
        assert!(!is_reminder_due(&r, &(base + chrono::Duration::milliseconds(1))));
    }

    // ── weekly_day ──────────────────────────────────────────────────────────

    #[test]
    fn weekly_triggers_on_matching_weekday() {
        // 2026-05-20 是週三 = 3
        let r = reminder(vec![weekly(&[3], "14:30")]);
        assert!(is_reminder_due(&r, &tpe(2026, 5, 20, 14, 30, 5)));
    }

    #[test]
    fn weekly_does_not_trigger_on_wrong_weekday() {
        let r = reminder(vec![weekly(&[1], "14:30")]);
        assert!(!is_reminder_due(&r, &tpe(2026, 5, 20, 14, 30, 5)));
    }

    // ── monthly_day ─────────────────────────────────────────────────────────

    #[test]
    fn monthly_triggers_on_matching_day() {
        let r = reminder(vec![monthly(20, "09:00")]);
        assert!(is_reminder_due(&r, &tpe(2026, 5, 20, 9, 0, 5)));
    }

    #[test]
    fn monthly_does_not_trigger_on_wrong_day() {
        let r = reminder(vec![monthly(15, "09:00")]);
        assert!(!is_reminder_due(&r, &tpe(2026, 5, 20, 9, 0, 5)));
    }

    #[test]
    fn monthly_31_is_skipped_in_short_month() {
        // 短月份：設定 31 號，2026 年 4 月只有 30 天，整個月都不會觸發；5/31 才觸發
        let r = reminder(vec![monthly(31, "09:00")]);
        for day in 1..=30 {
            assert!(!is_reminder_due(&r, &tpe(2026, 4, day, 9, 0, 5)));
        }
        assert!(!is_reminder_due(&r, &tpe(2026, 5, 1, 9, 0, 5)));
        assert!(is_reminder_due(&r, &tpe(2026, 5, 31, 9, 0, 5)));
    }

    // ── interval ────────────────────────────────────────────────────────────

    #[test]
    fn interval_triggers_when_minutes_align() {
        let r = reminder(vec![interval(30, None, None, &[])]);
        assert!(is_reminder_due(&r, &tpe(2026, 5, 20, 10, 0, 10)));
    }

    #[test]
    fn interval_does_not_trigger_mid_interval() {
        let r = reminder(vec![interval(30, None, None, &[])]);
        assert!(!is_reminder_due(&r, &tpe(2026, 5, 20, 10, 15, 5)));
    }

    #[test]
    fn interval_respects_active_window() {
        let r = reminder(vec![interval(60, Some("09:00"), Some("17:00"), &[])]);
        assert!(!is_reminder_due(&r, &tpe(2026, 5, 20, 8, 0, 5)));
    }

    #[test]
    fn interval_anchors_to_active_from() {
        let r = reminder(vec![interval(60, Some("09:30"), Some("18:00"), &[])]);
        assert!(is_reminder_due(&r, &tpe(2026, 5, 20, 10, 30, 5)));
        assert!(!is_reminder_due(&r, &tpe(2026, 5, 20, 10, 0, 5)));
    }

    #[test]
    fn interval_only_active_from() {
        let r = reminder(vec![interval(60, Some("09:00"), None, &[])]);
        assert!(is_reminder_due(&r, &tpe(2026, 5, 20, 10, 0, 5)));
        assert!(!is_reminder_due(&r, &tpe(2026, 5, 20, 8, 0, 5)));
    }

    #[test]
    fn interval_overnight_window() {
        let r = reminder(vec![interval(60, Some("23:30"), Some("01:00"), &[])]);
        assert!(is_reminder_due(&r, &tpe(2026, 5, 20, 0, 30, 5)));
        assert!(!is_reminder_due(&r, &tpe(2026, 5, 20, 12, 0, 5)));
        assert!(is_reminder_due(&r, &tpe(2026, 5, 20, 23, 30, 5)));
    }

    #[test]
    fn interval_seconds_limit_is_30() {
        let r = reminder(vec![interval(30, None, None, &[])]);
        assert!(is_reminder_due(&r, &tpe(2026, 5, 20, 10, 0, 30)));
        assert!(!is_reminder_due(&r, &tpe(2026, 5, 20, 10, 0, 31)));
    }

    #[test]
    fn interval_week_day_filter() {
        // 2026-05-20 週三
        let weekdays = reminder(vec![interval(60, None, None, &[1, 2, 3, 4, 5])]);
        let weekend = reminder(vec![interval(60, None, None, &[0, 6])]);
        assert!(is_reminder_due(&weekdays, &tpe(2026, 5, 20, 10, 0, 5)));
        assert!(!is_reminder_due(&weekend, &tpe(2026, 5, 20, 10, 0, 5)));
    }

    #[test]
    fn invalid_time_strings_never_trigger() {
        let r = reminder(vec![daily("ab:cd")]);
        assert!(!is_reminder_due(&r, &tpe(2026, 5, 20, 0, 0, 5)));
        let r = reminder(vec![interval(60, Some("xx:yy"), Some("18:00"), &[])]);
        assert!(!is_reminder_due(&r, &tpe(2026, 5, 20, 10, 0, 5)));
    }

    // ── endAt / enabled ─────────────────────────────────────────────────────

    #[test]
    fn disabled_does_not_trigger() {
        let r = ReminderRow { enabled: false, ..one_time(tpe(2026, 5, 20, 10, 0, 0)) };
        assert!(!is_reminder_due(&r, &tpe(2026, 5, 20, 10, 0, 10)));
    }

    #[test]
    fn past_end_at_does_not_trigger() {
        let r = ReminderRow {
            end_at: Some(tpe(2026, 5, 19, 0, 0, 0).timestamp_millis()),
            ..one_time(tpe(2026, 5, 20, 10, 0, 0))
        };
        assert!(!is_reminder_due(&r, &tpe(2026, 5, 20, 10, 0, 10)));
        // 重複提醒也一樣
        let r = ReminderRow {
            end_at: Some(tpe(2026, 5, 19, 0, 0, 0).timestamp_millis()),
            ..reminder(vec![daily("10:00")])
        };
        assert!(!is_reminder_due(&r, &tpe(2026, 5, 20, 10, 0, 10)));
    }

    // ── 使用者時區（本機版的「時區」就是傳進來的 DateTime 的時區） ─────────

    #[test]
    fn timezone_taipei_daily_0900_is_0100z() {
        let r = reminder(vec![daily("09:00")]);
        assert!(is_reminder_due(&r, &utc(2026, 5, 20, 1, 0, 5).with_timezone(&tz(8))));
        assert!(!is_reminder_due(&r, &utc(2026, 5, 20, 9, 0, 5).with_timezone(&tz(8))));
    }

    #[test]
    fn timezone_utc_user_daily_0900() {
        let r = reminder(vec![daily("09:00")]);
        assert!(is_reminder_due(&r, &utc(2026, 5, 20, 9, 0, 5)));
        assert!(!is_reminder_due(&r, &utc(2026, 5, 20, 1, 0, 5)));
    }

    #[test]
    fn timezone_weekly_crosses_day_boundary() {
        // 台灣週一 2026-05-18 07:00 = 2026-05-17T23:00Z（UTC 仍是週日）
        let now = utc(2026, 5, 17, 23, 0, 5).with_timezone(&tz(8));
        assert!(is_reminder_due(&reminder(vec![weekly(&[1], "07:00")]), &now));
        assert!(!is_reminder_due(&reminder(vec![weekly(&[0], "07:00")]), &now));
    }

    #[test]
    fn timezone_sunday_night_is_not_monday() {
        let now = utc(2026, 5, 17, 15, 30, 5).with_timezone(&tz(8));
        assert!(!is_reminder_due(&reminder(vec![weekly(&[1], "23:30")]), &now));
        assert!(is_reminder_due(&reminder(vec![weekly(&[0], "23:30")]), &now));
    }

    #[test]
    fn timezone_monthly_crosses_month_boundary() {
        let now = utc(2026, 5, 31, 23, 0, 5).with_timezone(&tz(8));
        assert!(is_reminder_due(&reminder(vec![monthly(1, "07:00")]), &now));
        assert!(!is_reminder_due(&reminder(vec![monthly(31, "07:00")]), &now));
    }

    #[test]
    fn timezone_interval_weekday_and_window() {
        let r = reminder(vec![interval(60, Some("07:00"), Some("18:00"), &[1])]);
        let instant = utc(2026, 5, 17, 23, 0, 5);
        assert!(is_reminder_due(&r, &instant.with_timezone(&tz(8))));
        assert!(!is_reminder_due(&r, &instant));
    }

    #[test]
    fn timezone_negative_offset_new_york_summer() {
        // America/New_York 夏令 UTC-4：每日 21:00 = 隔天 01:00Z
        let r = reminder(vec![daily("21:00")]);
        assert!(is_reminder_due(&r, &utc(2026, 7, 2, 1, 0, 5).with_timezone(&tz(-4))));
        assert!(!is_reminder_due(&r, &utc(2026, 7, 1, 21, 0, 5).with_timezone(&tz(-4))));
    }

    // ── checkDue（對應「多使用者 / 多裝置佇列」裡跟單機有關的案例） ─────────

    fn db_with(reminders: &[(&str, &str)]) -> LocalDb {
        // (id, extra SQL 片段)
        let db = LocalDb::new(open_in_memory().unwrap());
        for (i, (id, _)) in reminders.iter().enumerate() {
            db.conn
                .execute(
                    r#"INSERT INTO "Reminder" ("id","title","scheduleType","sortOrder","createdAt","updatedAt")
                       VALUES (?1, ?2, 'recurring', ?3, 0, 0)"#,
                    params![id, format!("title-{id}"), i as i64],
                )
                .unwrap();
            db.conn
                .execute(
                    r#"INSERT INTO "RecurrenceRule" ("id","ruleMode","timeOfDay","reminderId")
                       VALUES (?1, 'daily_time', '09:00', ?2)"#,
                    params![format!("rule-{id}"), id],
                )
                .unwrap();
        }
        for (id, extra) in reminders {
            if !extra.is_empty() {
                db.conn
                    .execute(&format!(r#"UPDATE "Reminder" SET {extra} WHERE "id" = ?1"#), [id])
                    .unwrap();
            }
        }
        db
    }

    fn fire_count(db: &LocalDb, id: &str) -> i64 {
        db.conn
            .query_row(r#"SELECT "fireCount" FROM "Reminder" WHERE "id" = ?1"#, [id], |r| r.get(0))
            .unwrap()
    }

    // 台灣 2026-05-20 09:00:05
    fn fire_at() -> DateTime<FixedOffset> {
        tpe(2026, 5, 20, 9, 0, 5)
    }

    #[test]
    fn check_due_pushes_once_per_window() {
        let mut db = db_with(&[("r1", "")]);
        let first = check_due(&mut db, &fire_at()).unwrap();
        assert_eq!(first.iter().map(|d| d.id.as_str()).collect::<Vec<_>>(), vec!["r1"]);
        assert!(check_due(&mut db, &(fire_at() + chrono::Duration::seconds(3))).unwrap().is_empty());
        assert!(check_due(&mut db, &(fire_at() + chrono::Duration::seconds(6))).unwrap().is_empty());
    }

    #[test]
    fn check_due_skips_disabled() {
        let mut db = db_with(&[("r1", r#""enabled" = 0"#)]);
        assert!(check_due(&mut db, &fire_at()).unwrap().is_empty());
    }

    #[test]
    fn check_due_uses_display_setting_or_defaults() {
        let mut db = db_with(&[("r1", "")]);
        let due = check_due(&mut db, &fire_at()).unwrap();
        assert_eq!(due[0].corner, "bottom_right");
        assert_eq!(due[0].size, "medium");
        assert_eq!(due[0].target_screen_id, None);

        let mut db = db_with(&[("r1", "")]);
        db.conn
            .execute(
                r#"INSERT INTO "DisplaySetting" ("id","size","corner","targetScreenId") VALUES ('d','large','top_left','screen-2')"#,
                [],
            )
            .unwrap();
        let due = check_due(&mut db, &fire_at()).unwrap();
        assert_eq!(due[0].corner, "top_left");
        assert_eq!(due[0].size, "large");
        assert_eq!(due[0].target_screen_id.as_deref(), Some("screen-2"));
    }

    #[test]
    fn due_reminder_shape_is_unchanged() {
        let mut db = db_with(&[("r1", "")]);
        let due = check_due(&mut db, &fire_at()).unwrap();
        let json = serde_json::to_value(&due[0]).unwrap();
        let mut keys: Vec<_> = json.as_object().unwrap().keys().cloned().collect();
        keys.sort();
        let mut expected = vec![
            "id", "title", "content", "autoCloseEnabled", "autoCloseSeconds",
            "snoozeDefaultSeconds", "corner", "size", "targetScreenId",
        ];
        expected.sort();
        assert_eq!(keys, expected);
    }

    #[test]
    fn max_occurrences_persists_fire_count_and_stops() {
        let mut db = db_with(&[("r1", r#""maxOccurrences" = 1"#)]);
        assert_eq!(check_due(&mut db, &fire_at()).unwrap().len(), 1);
        assert_eq!(fire_count(&db, "r1"), 1);
        // 隔天同一時間：已達上限
        let next_day = fire_at() + chrono::Duration::days(1);
        assert!(check_due(&mut db, &next_day).unwrap().is_empty());
        assert_eq!(fire_count(&db, "r1"), 1);
    }

    #[test]
    fn fire_count_without_max_occurrences_is_not_counted() {
        let mut db = db_with(&[("r1", "")]);
        check_due(&mut db, &fire_at()).unwrap();
        assert_eq!(fire_count(&db, "r1"), 0);
    }

    #[test]
    fn end_at_stops_recurring() {
        let end = tpe(2026, 5, 20, 0, 0, 0).timestamp_millis();
        let mut db = db_with(&[("r1", &format!(r#""endAt" = {end}"#))]);
        assert!(check_due(&mut db, &fire_at()).unwrap().is_empty());
    }

    #[test]
    fn snooze_expiry_fires_regardless_of_schedule_and_is_not_counted() {
        let snooze_until = fire_at().timestamp_millis() + 60_000;
        let mut db = db_with(&[(
            "r1",
            &format!(r#""snoozeUntil" = {snooze_until}, "maxOccurrences" = 5"#),
        )]);
        // 延後中：就算排程時間到了也不觸發
        assert!(check_due(&mut db, &fire_at()).unwrap().is_empty());
        // 延後到期：不在排程視窗也會再推一次
        let later = fire_at() + chrono::Duration::seconds(61);
        let due = check_due(&mut db, &later).unwrap();
        assert_eq!(due.iter().map(|d| d.id.as_str()).collect::<Vec<_>>(), vec!["r1"]);
        assert_eq!(fire_count(&db, "r1"), 0);
        let cleared: Option<i64> = db
            .conn
            .query_row(r#"SELECT "snoozeUntil" FROM "Reminder" WHERE "id" = 'r1'"#, [], |r| r.get(0))
            .unwrap();
        assert_eq!(cleared, None);
        // 之後不會重複推
        assert!(check_due(&mut db, &(later + chrono::Duration::seconds(3))).unwrap().is_empty());
    }

    #[test]
    fn snooze_in_db_survives_restart() {
        // 延後狀態存 DB：換一個新的 LocalDb（模擬重開 App，firedSet 清空）照樣生效
        let snooze_until = fire_at().timestamp_millis() + 60_000;
        let db = db_with(&[("r1", &format!(r#""snoozeUntil" = {snooze_until}"#))]);
        let mut restarted = LocalDb::new(db.conn);
        let later = fire_at() + chrono::Duration::seconds(61);
        assert_eq!(check_due(&mut restarted, &later).unwrap().len(), 1);
    }

    #[test]
    fn fired_set_entries_expire_after_retention() {
        let mut db = db_with(&[("r1", "")]);
        check_due(&mut db, &fire_at()).unwrap();
        assert_eq!(db.fired.len(), 1);
        check_due(&mut db, &(fire_at() + chrono::Duration::minutes(6))).unwrap();
        assert!(db.fired.is_empty());
    }

    #[test]
    fn works_with_local_and_utc_timezones() {
        // 實際執行時傳 chrono::Local::now()；確認泛型版本能吃 Local / Utc
        let r = reminder(vec![daily("09:00")]);
        let _ = is_reminder_due(&r, &chrono::Local::now());
        let _ = is_reminder_due(&r, &Utc::now());
    }
}
