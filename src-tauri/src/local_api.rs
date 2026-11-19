// src-tauri/src/local_api.rs
//
// 本機模式的 API 路由器。前端的 apiFetch 在本機模式下改呼叫
// `invoke('local_api', { method, path, body })`，這裡實作跟雲端後端**相同的 API 合約**：
// 路徑、JSON 欄位名、預設值、狀態碼、錯誤 body，頁面與元件不需要知道目前是哪個模式。
//
// 合約來源（改這邊時要一起看）：
// - backend/src/reminders、groups、display-settings 的 controller / service / dto
// - backend/src/app.setup.ts 的 ValidationPipe（whitelist + forbidNonWhitelisted + transform）
// - docs/architecture.md 的 API 章節與錯誤代碼
//
// 錯誤 body 跟 NestJS 一樣：
// - 一般例外（NotFound / BadRequest / Conflict）：`{ message, error, statusCode }`
// - DTO 驗證失敗：`{ message: string[], error: 'Bad Request', statusCode: 400 }`
// - 自訂 code 的例外（SHORT_MONTH_CONFIRMATION_REQUIRED）：`{ code, message }`
// - 未知路徑：`404 { message: 'Cannot GET /xxx', error: 'Not Found', statusCode: 404 }`
//
// 回應不含 userId（本機資料沒有帳號）。

use crate::local_store::{
    self, now_ms, to_iso, DisplayRow, GroupRow, LocalDb, LocalStore, ReminderFilter, ReminderRow,
};
use chrono::{Duration, Local, NaiveDate, TimeZone};
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use serde_json::{json, Map, Value};

#[derive(Debug, Serialize, PartialEq)]
pub struct LocalApiResponse {
    pub status: u16,
    pub body: Value,
}

#[tauri::command]
pub fn local_api(
    method: String,
    path: String,
    body: Option<String>,
    store: tauri::State<'_, LocalStore>,
) -> LocalApiResponse {
    let mut guard = store.0.lock().unwrap_or_else(|e| e.into_inner());
    let Some(db) = guard.as_mut() else {
        return LocalApiResponse {
            status: 500,
            body: json!({ "statusCode": 500, "message": "本機資料庫無法開啟" }),
        };
    };
    let (status, body) = handle(db, &method, &path, body.as_deref(), now_ms());
    LocalApiResponse { status, body }
}

/// 路由器本體（測試直接呼叫這個）。`now` 是 Unix 毫秒，延後與 createdAt 用。
pub fn handle(db: &mut LocalDb, method: &str, path: &str, body: Option<&str>, now: i64) -> (u16, Value) {
    match route(db, method, path, body, now) {
        Ok(ok) => ok,
        Err(e) => (e.status, e.body),
    }
}

// ── 錯誤 ────────────────────────────────────────────────────────────────────

#[derive(Debug)]
pub struct ApiError {
    status: u16,
    body: Value,
}

fn http_error(status: u16, error: &str, message: Value) -> ApiError {
    ApiError {
        status,
        body: json!({ "message": message, "error": error, "statusCode": status }),
    }
}

fn not_found(message: &str) -> ApiError {
    http_error(404, "Not Found", json!(message))
}

fn bad_request(message: &str) -> ApiError {
    http_error(400, "Bad Request", json!(message))
}

fn conflict(message: &str) -> ApiError {
    http_error(409, "Conflict", json!(message))
}

fn validation_failed(messages: Vec<String>) -> ApiError {
    http_error(400, "Bad Request", json!(messages))
}

/// 雲端後端遇到 Prisma 例外（例如必填欄位傳 null、Int 溢位）時回的 500。
fn internal() -> ApiError {
    ApiError {
        status: 500,
        body: json!({ "statusCode": 500, "message": "Internal server error" }),
    }
}

impl From<rusqlite::Error> for ApiError {
    fn from(e: rusqlite::Error) -> Self {
        log::error!("[local_api] 資料庫錯誤：{e}");
        internal()
    }
}

type ApiResult = Result<(u16, Value), ApiError>;

// ── 路由 ────────────────────────────────────────────────────────────────────

fn route(db: &mut LocalDb, method: &str, raw_path: &str, body: Option<&str>, now: i64) -> ApiResult {
    let method = method.to_ascii_uppercase();
    let path = raw_path.split(['?', '#']).next().unwrap_or("");
    // Express 預設不區分結尾斜線
    let trimmed = path.trim_end_matches('/');
    let segments: Vec<&str> = trimmed.trim_start_matches('/').split('/').collect();

    match (method.as_str(), segments.as_slice()) {
        ("GET", ["reminders"]) => reminders_find_all(db),
        ("POST", ["reminders"]) => reminders_create(db, &parse_body(body)?, now),
        ("POST", ["reminders", "reorder"]) => reminders_reorder(db, &parse_body(body)?, now),
        ("GET", ["reminders", id]) => Ok((200, reminder_json(&find_reminder(db, id)?))),
        ("PATCH", ["reminders", id]) => reminders_update(db, id, &parse_body(body)?, now),
        ("DELETE", ["reminders", id]) => reminders_remove(db, id),
        ("PATCH", ["reminders", id, "enable"]) => reminders_set_enabled(db, id, true, now),
        ("PATCH", ["reminders", id, "disable"]) => reminders_set_enabled(db, id, false, now),
        ("PATCH", ["reminders", id, "snooze"]) => reminders_snooze(db, id, &parse_body(body)?, now),
        ("GET", ["groups"]) => groups_find_all(db),
        ("POST", ["groups"]) => groups_create(db, &parse_body(body)?, now),
        ("PATCH", ["groups", id]) => groups_rename(db, id, &parse_body(body)?),
        ("DELETE", ["groups", id]) => groups_remove(db, id),
        ("GET", ["display-settings", "current"]) => display_get(db),
        ("PATCH", ["display-settings", "current"]) => display_update(db, &parse_body(body)?),
        _ => Err(not_found(&format!("Cannot {method} {path}"))),
    }
}

/// 沒有 body 視為 `{}`（跟 Express 沒有 JSON body 時一樣）。
fn parse_body(body: Option<&str>) -> Result<Map<String, Value>, ApiError> {
    let Some(raw) = body.filter(|b| !b.trim().is_empty()) else {
        return Ok(Map::new());
    };
    match serde_json::from_str::<Value>(raw) {
        Ok(Value::Object(map)) => Ok(map),
        Ok(_) => Err(validation_failed(vec![
            "an unknown value was passed to the validate function".to_string(),
        ])),
        Err(e) => Err(bad_request(&format!("請求內容不是合法的 JSON：{e}"))),
    }
}

// ── 驗證（對應 class-validator 的語意與訊息） ──────────────────────────────

/// 屬性在 JSON 裡的三種狀態：沒有這個 key（undefined）、null、有值。
fn get<'a>(obj: &'a Map<String, Value>, key: &str) -> Option<&'a Value> {
    obj.get(key)
}

/// `@IsOptional()`：undefined 或 null 時略過其他驗證。
fn absent(v: Option<&Value>) -> bool {
    matches!(v, None | Some(Value::Null))
}

fn is_string(v: &Value) -> bool {
    v.is_string()
}

fn is_int(v: &Value) -> bool {
    v.as_f64().is_some_and(|f| f.is_finite() && f.fract() == 0.0)
}

fn num(v: &Value) -> Option<f64> {
    v.as_f64()
}

/// validator.js 的 isLength：code point 數，扣掉 variation selector。
fn js_length(s: &str) -> usize {
    s.chars().filter(|c| *c != '\u{FE0E}' && *c != '\u{FE0F}').count()
}

fn utf16_len(s: &str) -> usize {
    s.encode_utf16().count()
}

struct Checker {
    errors: Vec<String>,
}

impl Checker {
    fn new() -> Self {
        Self { errors: Vec::new() }
    }

    fn push(&mut self, prefix: &str, msg: String) {
        self.errors.push(format!("{prefix}{msg}"));
    }

    /// forbidNonWhitelisted：DTO 沒宣告的屬性一律拒絕。
    fn whitelist(&mut self, obj: &Map<String, Value>, allowed: &[&str], prefix: &str) {
        for key in obj.keys() {
            if !allowed.contains(&key.as_str()) {
                self.push(prefix, format!("property {key} should not exist"));
            }
        }
    }

    fn string(&mut self, p: &str, prop: &str, v: &Value) {
        if !is_string(v) {
            self.push(p, format!("{prop} must be a string"));
        }
    }

    fn not_empty(&mut self, p: &str, prop: &str, v: &Value) {
        if v.is_null() || v.as_str() == Some("") {
            self.push(p, format!("{prop} should not be empty"));
        }
    }

    fn length(&mut self, p: &str, prop: &str, v: &Value, min: usize, max: usize) {
        let ok = v.as_str().is_some_and(|s| (min..=max).contains(&js_length(s)));
        if ok {
            return;
        }
        let len = v.as_str().map(utf16_len);
        let msg = match len {
            None | Some(0) => format!("{prop} must be longer than or equal to {min} characters"),
            Some(l) if l < min => format!("{prop} must be longer than or equal to {min} characters"),
            Some(l) if l > max => format!("{prop} must be shorter than or equal to {max} characters"),
            _ => format!(
                "{prop} must be longer than or equal to {min} and shorter than or equal to {max} characters"
            ),
        };
        self.push(p, msg);
    }

    fn max_length(&mut self, p: &str, prop: &str, v: &Value, max: usize) {
        if !v.as_str().is_some_and(|s| js_length(s) <= max) {
            self.push(p, format!("{prop} must be shorter than or equal to {max} characters"));
        }
    }

    fn enumeration(&mut self, p: &str, prop: &str, v: &Value, values: &[&str]) {
        if !v.as_str().is_some_and(|s| values.contains(&s)) {
            self.push(
                p,
                format!("{prop} must be one of the following values: {}", values.join(", ")),
            );
        }
    }

    fn boolean(&mut self, p: &str, prop: &str, v: &Value) {
        if !v.is_boolean() {
            self.push(p, format!("{prop} must be a boolean value"));
        }
    }

    fn int_range(&mut self, p: &str, prop: &str, v: &Value, min: Option<f64>, max: Option<f64>) {
        if !is_int(v) {
            self.push(p, format!("{prop} must be an integer number"));
        }
        if let Some(min) = min {
            if !num(v).is_some_and(|n| n >= min) {
                self.push(p, format!("{prop} must not be less than {min}"));
            }
        }
        if let Some(max) = max {
            if !num(v).is_some_and(|n| n <= max) {
                self.push(p, format!("{prop} must not be greater than {max}"));
            }
        }
    }

    fn date_string(&mut self, p: &str, prop: &str, v: &Value) {
        if !v.as_str().is_some_and(|s| parse_js_date(s).is_some()) {
            self.push(p, format!("{prop} must be a valid ISO 8601 date string"));
        }
    }

    fn uuid(&mut self, p: &str, prop: &str, v: &Value) {
        if !v.as_str().is_some_and(is_uuid) {
            self.push(p, format!("{prop} must be a UUID"));
        }
    }

    fn finish(self) -> Result<(), ApiError> {
        if self.errors.is_empty() {
            Ok(())
        } else {
            Err(validation_failed(self.errors))
        }
    }
}

/// validator.js 13.15 的 isUUID（未指定版本）：版本 1–8 + RFC 4122 variant，或 nil / max UUID。
fn is_uuid(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() != 36 {
        return false;
    }
    for (i, c) in b.iter().enumerate() {
        let dash = matches!(i, 8 | 13 | 18 | 23);
        if dash != (*c == b'-') || (!dash && !c.is_ascii_hexdigit()) {
            return false;
        }
    }
    let lower = s.to_ascii_lowercase();
    if lower == "00000000-0000-0000-0000-000000000000" || lower == "ffffffff-ffff-ffff-ffff-ffffffffffff" {
        return true;
    }
    let version = b[14];
    let variant = b[19].to_ascii_lowercase();
    (b'1'..=b'8').contains(&version) && matches!(variant, b'8' | b'9' | b'a' | b'b')
}

/// 對應 `new Date(isoString)`（只接受同時通過 class-validator 的 IsDateString 的格式）。
/// - `YYYY`、`YYYY-MM`、`YYYY-MM-DD`：UTC 午夜
/// - 有時間、沒有時區（例如前端送的 `2026-05-20T10:00`）：**作業系統本地時間**
/// - 有 `Z` 或 `±HH:mm` / `±HHmm`：照時區換算
/// - 日期超出該月天數、`24:00` 跟 V8 一樣往後進位
/// IsDateString 也接受、但 V8 解析失敗的格式（週日期、`20260520`、`T10`、`+08`）在雲端會變成
/// 500，這裡直接當驗證失敗（400）。
pub fn parse_js_date(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    let digits = |from: usize, n: usize| -> Option<u32> {
        let part = b.get(from..from + n)?;
        if !part.iter().all(u8::is_ascii_digit) {
            return None;
        }
        std::str::from_utf8(part).ok()?.parse().ok()
    };
    let year = digits(0, 4)? as i32;
    let mut i = 4;
    let mut month = 1;
    let mut day = 1;
    if b.get(i) == Some(&b'-') {
        month = digits(i + 1, 2)?;
        i += 3;
        if b.get(i) == Some(&b'-') {
            day = digits(i + 1, 2)?;
            i += 3;
        }
    }
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let date = NaiveDate::from_ymd_opt(year, month, 1)? + Duration::days(day as i64 - 1);

    if i == b.len() {
        return Some(date.and_hms_opt(0, 0, 0)?.and_utc().timestamp_millis());
    }
    // 只有完整日期才能接時間
    if i != 10 || !matches!(b[i], b'T' | b' ') {
        return None;
    }
    i += 1;
    let hour = digits(i, 2)?;
    if b.get(i + 2) != Some(&b':') {
        return None;
    }
    let minute = digits(i + 3, 2)?;
    i += 5;
    let mut second = 0;
    let mut millis = 0;
    if b.get(i) == Some(&b':') {
        second = digits(i + 1, 2)?;
        i += 3;
        if b.get(i) == Some(&b'.') {
            let start = i + 1;
            let mut end = start;
            while end < b.len() && b[end].is_ascii_digit() {
                end += 1;
            }
            if end == start {
                return None;
            }
            let frac = &s[start..end.min(start + 3)];
            millis = format!("{frac:0<3}").parse::<i64>().ok()?;
            i = end;
        }
    }
    if hour > 24 || minute > 59 || second > 59 || (hour == 24 && (minute != 0 || second != 0 || millis != 0)) {
        return None;
    }
    let wall = date.and_hms_opt(0, 0, 0)?
        + Duration::hours(hour as i64)
        + Duration::minutes(minute as i64)
        + Duration::seconds(second as i64)
        + Duration::milliseconds(millis);

    let rest = &s[i..];
    let offset_minutes: Option<i64> = match rest {
        "" => None,
        "Z" => Some(0),
        _ => {
            let sign = match rest.as_bytes()[0] {
                b'+' => 1,
                b'-' => -1,
                _ => return None,
            };
            let tz = &rest[1..];
            let (h, m) = match tz.len() {
                5 if tz.as_bytes()[2] == b':' => (&tz[0..2], &tz[3..5]),
                4 => (&tz[0..2], &tz[2..4]),
                _ => return None,
            };
            if !h.bytes().chain(m.bytes()).all(|c| c.is_ascii_digit()) {
                return None;
            }
            let (h, m): (i64, i64) = (h.parse().ok()?, m.parse().ok()?);
            if h > 23 || m > 59 {
                return None;
            }
            Some(sign * (h * 60 + m))
        }
    };
    match offset_minutes {
        Some(off) => Some((wall - Duration::minutes(off)).and_utc().timestamp_millis()),
        None => {
            // 本地時間：遇到日光節約時間的空隙就往後找第一個存在的時間（同 V8）
            let local = Local
                .from_local_datetime(&wall)
                .earliest()
                .or_else(|| Local.from_local_datetime(&(wall + Duration::hours(1))).earliest())?;
            Some(local.timestamp_millis())
        }
    }
}

// ── DTO：提醒 ───────────────────────────────────────────────────────────────

const SCHEDULE_TYPES: &[&str] = &["one_time", "recurring"];
const RULE_MODES: &[&str] = &["interval", "daily_time", "weekly_day", "monthly_day"];
const REMINDER_FIELDS: &[&str] = &[
    "title",
    "content",
    "scheduleType",
    "oneTimeAt",
    "enabled",
    "autoCloseEnabled",
    "autoCloseSeconds",
    "snoozeDefaultSeconds",
    "endAt",
    "maxOccurrences",
    "recurrenceRules",
    "groupId",
    "skipShortMonthConfirmation",
];
const RULE_FIELDS: &[&str] = &[
    "ruleMode",
    "monthDay",
    "weekDays",
    "timeOfDay",
    "intervalMinutes",
    "activeFrom",
    "activeUntil",
];

/// CreateReminderDto / UpdateReminderDto（PartialType：每個屬性都變成 IsOptional）。
fn validate_reminder_dto(obj: &Map<String, Value>, partial: bool) -> Result<(), ApiError> {
    let mut c = Checker::new();
    c.whitelist(obj, REMINDER_FIELDS, "");
    let p = "";

    let title = get(obj, "title");
    if !(partial && absent(title)) {
        let v = title.unwrap_or(&Value::Null);
        c.string(p, "title", v);
        c.not_empty(p, "title", v);
        c.length(p, "title", v, 1, 120);
    }
    if let Some(v) = get(obj, "content").filter(|v| !v.is_null()) {
        c.string(p, "content", v);
    }
    let schedule_type = get(obj, "scheduleType");
    if !(partial && absent(schedule_type)) {
        c.enumeration(p, "scheduleType", schedule_type.unwrap_or(&Value::Null), SCHEDULE_TYPES);
    }
    for key in ["oneTimeAt", "endAt"] {
        if let Some(v) = get(obj, key).filter(|v| !v.is_null()) {
            c.date_string(p, key, v);
        }
    }
    for key in ["enabled", "autoCloseEnabled", "skipShortMonthConfirmation"] {
        if let Some(v) = get(obj, key).filter(|v| !v.is_null()) {
            c.boolean(p, key, v);
        }
    }
    if let Some(v) = get(obj, "autoCloseSeconds").filter(|v| !v.is_null()) {
        c.int_range(p, "autoCloseSeconds", v, Some(1.0), Some(600.0));
    }
    if let Some(v) = get(obj, "snoozeDefaultSeconds").filter(|v| !v.is_null()) {
        c.int_range(p, "snoozeDefaultSeconds", v, Some(60.0), Some(600.0));
    }
    if let Some(v) = get(obj, "maxOccurrences").filter(|v| !v.is_null()) {
        c.int_range(p, "maxOccurrences", v, Some(1.0), None);
    }
    if let Some(v) = get(obj, "recurrenceRules").filter(|v| !v.is_null()) {
        match v {
            Value::Array(items) => {
                if items.len() > 3 {
                    c.push(p, "recurrenceRules must contain no more than 3 elements".into());
                }
                for (i, item) in items.iter().enumerate() {
                    match item {
                        Value::Object(rule) => validate_rule(&mut c, rule, &format!("recurrenceRules.{i}.")),
                        _ => c.push(p, "nested property recurrenceRules must be either object or array".into()),
                    }
                }
            }
            Value::Object(rule) => {
                c.push(p, "recurrenceRules must be an array".into());
                c.push(p, "recurrenceRules must contain no more than 3 elements".into());
                validate_rule(&mut c, rule, "recurrenceRules.");
            }
            _ => {
                c.push(p, "recurrenceRules must be an array".into());
                c.push(p, "recurrenceRules must contain no more than 3 elements".into());
                c.push(p, "nested property recurrenceRules must be either object or array".into());
            }
        }
    }
    // @IsOptional + @ValidateIf(groupId !== null) + @IsString
    if let Some(v) = get(obj, "groupId").filter(|v| !v.is_null()) {
        c.string(p, "groupId", v);
    }
    c.finish()
}

fn validate_rule(c: &mut Checker, rule: &Map<String, Value>, p: &str) {
    c.whitelist(rule, RULE_FIELDS, p);
    c.enumeration(p, "ruleMode", get(rule, "ruleMode").unwrap_or(&Value::Null), RULE_MODES);
    if let Some(v) = get(rule, "monthDay").filter(|v| !v.is_null()) {
        c.int_range(p, "monthDay", v, Some(1.0), Some(31.0));
    }
    if let Some(v) = get(rule, "weekDays").filter(|v| !v.is_null()) {
        match v {
            Value::Array(days) => {
                if days.iter().any(|d| !is_int(d)) {
                    c.push(p, "each value in weekDays must be an integer number".into());
                }
                if days.iter().any(|d| !num(d).is_some_and(|n| n >= 0.0)) {
                    c.push(p, "each value in weekDays must not be less than 0".into());
                }
                if days.iter().any(|d| !num(d).is_some_and(|n| n <= 6.0)) {
                    c.push(p, "each value in weekDays must not be greater than 6".into());
                }
                if days.len() > 7 {
                    c.push(p, "weekDays must contain no more than 7 elements".into());
                }
            }
            other => {
                c.push(p, "weekDays must be an array".into());
                if !is_int(other) {
                    c.push(p, "each value in weekDays must be an integer number".into());
                }
                if !num(other).is_some_and(|n| n >= 0.0) {
                    c.push(p, "each value in weekDays must not be less than 0".into());
                }
                if !num(other).is_some_and(|n| n <= 6.0) {
                    c.push(p, "each value in weekDays must not be greater than 6".into());
                }
                c.push(p, "weekDays must contain no more than 7 elements".into());
            }
        }
    }
    for key in ["timeOfDay", "activeFrom", "activeUntil"] {
        if let Some(v) = get(rule, key).filter(|v| !v.is_null()) {
            c.string(p, key, v);
            c.length(p, key, v, 5, 5);
        }
    }
    if let Some(v) = get(rule, "intervalMinutes").filter(|v| !v.is_null()) {
        c.int_range(p, "intervalMinutes", v, Some(1.0), Some(1440.0));
    }
}

/// 通過 DTO 驗證之後的一條規則（RecurrenceRuleInputDto）。
#[derive(Debug, Clone)]
struct RuleInput {
    rule_mode: String,
    month_day: Option<i64>,
    week_days: Option<Vec<i64>>,
    time_of_day: Option<String>,
    interval_minutes: Option<i64>,
    active_from: Option<String>,
    active_until: Option<String>,
}

fn opt_str(obj: &Map<String, Value>, key: &str) -> Option<String> {
    get(obj, key).and_then(|v| v.as_str()).map(str::to_string)
}

/// 驗證過的整數。超出 PostgreSQL Int（32 位元）範圍時雲端是 Prisma 例外 → 500。
fn opt_int(obj: &Map<String, Value>, key: &str) -> Result<Option<i64>, ApiError> {
    match get(obj, key).and_then(|v| v.as_f64()) {
        None => Ok(None),
        Some(f) if f >= i32::MIN as f64 && f <= i32::MAX as f64 => Ok(Some(f as i64)),
        Some(_) => Err(internal()),
    }
}

fn opt_bool(obj: &Map<String, Value>, key: &str) -> Option<bool> {
    get(obj, key).and_then(|v| v.as_bool())
}

fn parse_rules(value: Option<&Value>) -> Result<Option<Vec<RuleInput>>, ApiError> {
    let Some(Value::Array(items)) = value else {
        return Ok(None);
    };
    let mut rules = Vec::new();
    for item in items {
        let Value::Object(r) = item else { continue };
        let week_days = match get(r, "weekDays") {
            Some(Value::Array(days)) => Some(days.iter().filter_map(|d| d.as_f64()).map(|f| f as i64).collect()),
            _ => None,
        };
        rules.push(RuleInput {
            rule_mode: opt_str(r, "ruleMode").unwrap_or_default(),
            month_day: opt_int(r, "monthDay")?,
            week_days,
            time_of_day: opt_str(r, "timeOfDay"),
            interval_minutes: opt_int(r, "intervalMinutes")?,
            active_from: opt_str(r, "activeFrom"),
            active_until: opt_str(r, "activeUntil"),
        });
    }
    Ok(Some(rules))
}

fn truthy_str(s: &Option<String>) -> bool {
    s.as_deref().is_some_and(|s| !s.is_empty())
}

/// RemindersService.validateReminderInput 的移植（跨欄位規則，在 DTO 驗證之後）。
fn validate_reminder_input(
    schedule_type: &str,
    has_one_time_at: bool,
    rules: Option<&[RuleInput]>,
    skip_short_month: bool,
    confirmed_month_days: &[i64],
) -> Result<(), ApiError> {
    if schedule_type == "one_time" && !has_one_time_at {
        return Err(bad_request("單次提醒必須提供 oneTimeAt"));
    }
    if schedule_type == "recurring" && rules.map_or(true, |r| r.is_empty()) {
        return Err(bad_request("重複提醒必須至少提供一條 recurrenceRules"));
    }
    if schedule_type != "recurring" {
        return Ok(());
    }
    for rule in rules.unwrap_or_default() {
        match rule.rule_mode.as_str() {
            "daily_time" => {
                if !truthy_str(&rule.time_of_day) {
                    return Err(bad_request("daily_time 必須提供 timeOfDay"));
                }
            }
            "weekly_day" => {
                if rule.week_days.as_ref().map_or(true, |d| d.is_empty()) {
                    return Err(bad_request("weekly_day 必須選擇至少一個星期"));
                }
                if !truthy_str(&rule.time_of_day) {
                    return Err(bad_request("weekly_day 必須提供 timeOfDay"));
                }
            }
            "monthly_day" => {
                let Some(day) = rule.month_day.filter(|d| *d != 0) else {
                    return Err(bad_request("monthly_day 必須提供 monthDay"));
                };
                if !truthy_str(&rule.time_of_day) {
                    return Err(bad_request("monthly_day 必須提供 timeOfDay"));
                }
                let already_confirmed = confirmed_month_days.contains(&day);
                if day >= 29 && !skip_short_month && !already_confirmed {
                    return Err(ApiError {
                        status: 409,
                        body: json!({
                            "code": "SHORT_MONTH_CONFIRMATION_REQUIRED",
                            "message": "若遇到沒有該日期的月份，此月份將跳過提醒，是否確定繼續？",
                        }),
                    });
                }
            }
            "interval" => {
                if !rule.interval_minutes.is_some_and(|m| (1..=1440).contains(&m)) {
                    return Err(bad_request("interval 必須提供 intervalMinutes（1~1440 分鐘）"));
                }
                let has_from = truthy_str(&rule.active_from);
                let has_until = truthy_str(&rule.active_until);
                if has_from != has_until {
                    return Err(bad_request("interval 限定時段需同時提供 activeFrom 與 activeUntil"));
                }
                if has_from && has_until && rule.active_from >= rule.active_until {
                    return Err(bad_request("interval activeFrom 必須早於 activeUntil（不支援跨夜）"));
                }
            }
            _ => {}
        }
    }
    Ok(())
}

// ── JSON 輸出（欄位與 Prisma 回傳的物件相同，少了 userId） ─────────────────

fn opt_iso(ms: Option<i64>) -> Value {
    ms.map(|m| Value::String(to_iso(m))).unwrap_or(Value::Null)
}

fn group_json(g: &GroupRow) -> Value {
    json!({ "id": g.id, "name": g.name, "createdAt": to_iso(g.created_at) })
}

fn reminder_json(r: &ReminderRow) -> Value {
    let rules: Vec<Value> = r
        .rules
        .iter()
        .map(|rule| {
            json!({
                "id": rule.id,
                "ruleMode": rule.rule_mode,
                "monthDay": rule.month_day,
                "weekDays": rule.week_days,
                "timeOfDay": rule.time_of_day,
                "intervalMinutes": rule.interval_minutes,
                "activeFrom": rule.active_from,
                "activeUntil": rule.active_until,
                "reminderId": rule.reminder_id,
            })
        })
        .collect();
    json!({
        "id": r.id,
        "title": r.title,
        "content": r.content,
        "enabled": r.enabled,
        "scheduleType": r.schedule_type,
        "oneTimeAt": opt_iso(r.one_time_at),
        "autoCloseEnabled": r.auto_close_enabled,
        "autoCloseSeconds": r.auto_close_seconds,
        "snoozeDefaultSeconds": r.snooze_default_seconds,
        "sortOrder": r.sort_order,
        "endAt": opt_iso(r.end_at),
        "maxOccurrences": r.max_occurrences,
        "fireCount": r.fire_count,
        "groupId": r.group_id,
        "createdAt": to_iso(r.created_at),
        "updatedAt": to_iso(r.updated_at),
        "recurrenceRules": rules,
        "group": r.group.as_ref().map(group_json),
    })
}

fn display_json(conn: &rusqlite::Connection, d: &DisplayRow) -> Result<Value, ApiError> {
    let mut stmt = conn.prepare(
        r#"SELECT "id", "filePath", "mimeType", "width", "height", "sizeBytes", "displaySettingId"
           FROM "MascotImage" WHERE "displaySettingId" = ?1 ORDER BY rowid"#,
    )?;
    let images = stmt
        .query_map([&d.id], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "filePath": row.get::<_, String>(1)?,
                "mimeType": row.get::<_, String>(2)?,
                "width": row.get::<_, i64>(3)?,
                "height": row.get::<_, i64>(4)?,
                "sizeBytes": row.get::<_, i64>(5)?,
                "displaySettingId": row.get::<_, String>(6)?,
            }))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(json!({
        "id": d.id,
        "size": d.size,
        "theme": d.theme,
        "corner": d.corner,
        "showContent": d.show_content,
        "targetScreenId": d.target_screen_id,
        "mascotMode": d.mascot_mode,
        "mascotIcon": d.mascot_icon,
        "mascotImages": images,
    }))
}

// ── /reminders ──────────────────────────────────────────────────────────────

fn find_reminder(db: &LocalDb, id: &str) -> Result<ReminderRow, ApiError> {
    local_store::load_reminder(&db.conn, id)?.ok_or_else(|| not_found("提醒不存在"))
}

fn assert_group_exists(db: &LocalDb, group_id: &str) -> Result<(), ApiError> {
    let exists = db
        .conn
        .query_row(r#"SELECT 1 FROM "Group" WHERE "id" = ?1"#, [group_id], |_| Ok(()))
        .optional()?;
    exists.ok_or_else(|| not_found("指定的群組不存在"))
}

fn reminders_find_all(db: &LocalDb) -> ApiResult {
    let list = local_store::load_reminders(&db.conn, ReminderFilter::All)?;
    Ok((200, Value::Array(list.iter().map(reminder_json).collect())))
}

fn insert_rules(tx: &rusqlite::Transaction<'_>, reminder_id: &str, rules: &[RuleInput]) -> Result<(), ApiError> {
    for rule in rules {
        tx.execute(
            r#"INSERT INTO "RecurrenceRule" ("id", "ruleMode", "monthDay", "weekDays", "timeOfDay",
                   "intervalMinutes", "activeFrom", "activeUntil", "reminderId")
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)"#,
            params![
                local_store::new_id(),
                rule.rule_mode,
                rule.month_day,
                serde_json::to_string(&rule.week_days.clone().unwrap_or_default()).unwrap_or_else(|_| "[]".into()),
                rule.time_of_day,
                rule.interval_minutes,
                rule.active_from,
                rule.active_until,
                reminder_id,
            ],
        )?;
    }
    Ok(())
}

fn reminders_create(db: &mut LocalDb, dto: &Map<String, Value>, now: i64) -> ApiResult {
    validate_reminder_dto(dto, false)?;
    let rules = parse_rules(get(dto, "recurrenceRules"))?;
    let schedule_type = opt_str(dto, "scheduleType").unwrap_or_default();
    let one_time_at = opt_str(dto, "oneTimeAt");
    validate_reminder_input(
        &schedule_type,
        truthy_str(&one_time_at),
        rules.as_deref(),
        opt_bool(dto, "skipShortMonthConfirmation").unwrap_or(false),
        &[],
    )?;

    let max_sort: Option<i64> = db
        .conn
        .query_row(r#"SELECT MAX("sortOrder") FROM "Reminder""#, [], |r| r.get(0))?;
    let sort_order = max_sort.unwrap_or(-1) + 1;

    let group_id = opt_str(dto, "groupId").filter(|g| !g.is_empty());
    if let Some(g) = &group_id {
        assert_group_exists(db, g)?;
    }

    let id = local_store::new_id();
    let max_occurrences = opt_int(dto, "maxOccurrences")?;
    let tx = db.conn.transaction()?;
    tx.execute(
        r#"INSERT INTO "Reminder" ("id", "title", "content", "enabled", "scheduleType", "oneTimeAt",
               "autoCloseEnabled", "autoCloseSeconds", "snoozeDefaultSeconds", "endAt", "maxOccurrences",
               "sortOrder", "groupId", "createdAt", "updatedAt")
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14)"#,
        params![
            id,
            opt_str(dto, "title").unwrap_or_default(),
            opt_str(dto, "content").unwrap_or_default(),
            opt_bool(dto, "enabled").unwrap_or(true),
            schedule_type,
            one_time_at.as_deref().filter(|s| !s.is_empty()).and_then(parse_js_date),
            opt_bool(dto, "autoCloseEnabled").unwrap_or(false),
            opt_int(dto, "autoCloseSeconds")?.unwrap_or(60),
            opt_int(dto, "snoozeDefaultSeconds")?.unwrap_or(300),
            opt_str(dto, "endAt").as_deref().filter(|s| !s.is_empty()).and_then(parse_js_date),
            max_occurrences,
            sort_order,
            group_id,
            now,
        ],
    )?;
    insert_rules(&tx, &id, rules.as_deref().unwrap_or_default())?;
    tx.commit()?;
    Ok((201, reminder_json(&find_reminder(db, &id)?)))
}

fn reminders_update(db: &mut LocalDb, id: &str, dto: &Map<String, Value>, now: i64) -> ApiResult {
    validate_reminder_dto(dto, true)?;
    let current = find_reminder(db, id)?;

    let confirmed_month_days: Vec<i64> = current
        .rules
        .iter()
        .filter(|r| r.rule_mode == "monthly_day")
        .filter_map(|r| r.month_day)
        .filter(|d| *d >= 29)
        .collect();

    // dto.x ?? current.x（null 也視為沒給）
    let schedule_type = opt_str(dto, "scheduleType").unwrap_or_else(|| current.schedule_type.clone());
    // dto.oneTimeAt !== undefined ? (dto.oneTimeAt ?? undefined) : current.oneTimeAt
    let one_time_at_input: Option<Option<String>> = get(dto, "oneTimeAt").map(|v| v.as_str().map(str::to_string));
    let has_one_time_at = match &one_time_at_input {
        Some(v) => truthy_str(v),
        None => current.one_time_at.is_some(),
    };
    let dto_rules = parse_rules(get(dto, "recurrenceRules"))?;
    let merged_rules: Vec<RuleInput> = match &dto_rules {
        Some(r) => r.clone(),
        None => current
            .rules
            .iter()
            .map(|r| RuleInput {
                rule_mode: r.rule_mode.clone(),
                month_day: r.month_day,
                week_days: Some(r.week_days.clone()),
                time_of_day: r.time_of_day.clone(),
                interval_minutes: r.interval_minutes,
                active_from: r.active_from.clone(),
                active_until: r.active_until.clone(),
            })
            .collect(),
    };
    validate_reminder_input(
        &schedule_type,
        has_one_time_at,
        Some(&merged_rules),
        opt_bool(dto, "skipShortMonthConfirmation").unwrap_or(false),
        &confirmed_month_days,
    )?;

    let one_time_at = match &one_time_at_input {
        Some(v) => v.as_deref().filter(|s| !s.is_empty()).and_then(parse_js_date),
        None => current.one_time_at,
    };
    let end_at = match get(dto, "endAt") {
        Some(v) => v.as_str().filter(|s| !s.is_empty()).and_then(parse_js_date),
        None => current.end_at,
    };
    // dto.maxOccurrences !== undefined ? dto.maxOccurrences : current（null 會清掉）
    let max_occurrences = match get(dto, "maxOccurrences") {
        Some(_) => opt_int(dto, "maxOccurrences")?,
        None => current.max_occurrences,
    };
    let group_id = match get(dto, "groupId") {
        None => current.group_id.clone(),
        Some(v) => match v.as_str().filter(|s| !s.is_empty()) {
            Some(g) => {
                assert_group_exists(db, g)?;
                Some(g.to_string())
            }
            None => None,
        },
    };
    // 雲端版 recurrenceRules: null 會在 null.map 時丟例外 → 500
    if matches!(get(dto, "recurrenceRules"), Some(Value::Null)) {
        return Err(internal());
    }

    let tx = db.conn.transaction()?;
    tx.execute(
        r#"UPDATE "Reminder" SET "title" = ?2, "content" = ?3, "scheduleType" = ?4, "oneTimeAt" = ?5,
               "enabled" = ?6, "autoCloseEnabled" = ?7, "autoCloseSeconds" = ?8, "snoozeDefaultSeconds" = ?9,
               "endAt" = ?10, "maxOccurrences" = ?11, "groupId" = ?12, "updatedAt" = ?13,
               -- resetReminder：清掉延後狀態與 fireCount
               "snoozeUntil" = NULL, "fireCount" = 0
           WHERE "id" = ?1"#,
        params![
            id,
            opt_str(dto, "title").unwrap_or(current.title.clone()),
            opt_str(dto, "content").unwrap_or(current.content.clone()),
            schedule_type,
            one_time_at,
            opt_bool(dto, "enabled").unwrap_or(current.enabled),
            opt_bool(dto, "autoCloseEnabled").unwrap_or(current.auto_close_enabled),
            opt_int(dto, "autoCloseSeconds")?.unwrap_or(current.auto_close_seconds),
            opt_int(dto, "snoozeDefaultSeconds")?.unwrap_or(current.snooze_default_seconds),
            end_at,
            max_occurrences,
            group_id,
            now,
        ],
    )?;
    if let Some(rules) = &dto_rules {
        tx.execute(r#"DELETE FROM "RecurrenceRule" WHERE "reminderId" = ?1"#, [id])?;
        insert_rules(&tx, id, rules)?;
    }
    tx.commit()?;
    db.clear_fired(id);
    Ok((200, reminder_json(&find_reminder(db, id)?)))
}

fn reminders_remove(db: &mut LocalDb, id: &str) -> ApiResult {
    find_reminder(db, id)?;
    db.conn.execute(r#"DELETE FROM "Reminder" WHERE "id" = ?1"#, [id])?;
    db.clear_fired(id);
    Ok((200, json!({ "success": true })))
}

fn reminders_set_enabled(db: &mut LocalDb, id: &str, enabled: bool, now: i64) -> ApiResult {
    find_reminder(db, id)?;
    db.conn.execute(
        r#"UPDATE "Reminder" SET "enabled" = ?2, "updatedAt" = ?3 WHERE "id" = ?1"#,
        params![id, enabled, now],
    )?;
    Ok((200, reminder_json(&find_reminder(db, id)?)))
}

fn reminders_reorder(db: &mut LocalDb, dto: &Map<String, Value>, now: i64) -> ApiResult {
    let mut c = Checker::new();
    c.whitelist(dto, &["items"], "");
    match get(dto, "items") {
        Some(Value::Array(items)) => {
            for (i, item) in items.iter().enumerate() {
                let p = format!("items.{i}.");
                match item {
                    Value::Object(o) => {
                        c.whitelist(o, &["id", "sortOrder"], &p);
                        c.uuid(&p, "id", get(o, "id").unwrap_or(&Value::Null));
                        c.int_range(&p, "sortOrder", get(o, "sortOrder").unwrap_or(&Value::Null), Some(0.0), None);
                    }
                    _ => c.push("", "nested property items must be either object or array".into()),
                }
            }
        }
        _ => {
            c.push("", "items must be an array".into());
            c.push("", "nested property items must be either object or array".into());
        }
    }
    c.finish()?;

    let mut items: Vec<(String, i64)> = Vec::new();
    if let Some(Value::Array(arr)) = get(dto, "items") {
        for item in arr {
            let Value::Object(o) = item else { continue };
            let sort = opt_int(o, "sortOrder")?.unwrap_or(0);
            items.push((opt_str(o, "id").unwrap_or_default(), sort));
        }
    }
    let mut unique: Vec<&str> = items.iter().map(|(id, _)| id.as_str()).collect();
    unique.sort_unstable();
    unique.dedup();
    let mut owned = 0;
    for id in &unique {
        if local_store::load_reminder(&db.conn, id)?.is_some() {
            owned += 1;
        }
    }
    if owned != unique.len() {
        return Err(not_found("排序資料包含不存在的提醒 id"));
    }

    let tx = db.conn.transaction()?;
    for (id, sort) in &items {
        tx.execute(
            r#"UPDATE "Reminder" SET "sortOrder" = ?2, "updatedAt" = ?3 WHERE "id" = ?1"#,
            params![id, sort, now],
        )?;
    }
    tx.commit()?;
    // @Post 預設 201
    let list = local_store::load_reminders(&db.conn, ReminderFilter::All)?;
    Ok((201, Value::Array(list.iter().map(reminder_json).collect())))
}

fn reminders_snooze(db: &mut LocalDb, id: &str, dto: &Map<String, Value>, now: i64) -> ApiResult {
    let mut c = Checker::new();
    c.whitelist(dto, &["seconds"], "");
    c.int_range("", "seconds", get(dto, "seconds").unwrap_or(&Value::Null), Some(1.0), None);
    c.finish()?;
    let seconds = get(dto, "seconds").and_then(|v| v.as_f64()).unwrap_or(1.0);
    let until = now.saturating_add((seconds * 1000.0) as i64);

    let reminder = find_reminder(db, id)?;
    if reminder.schedule_type == "one_time" {
        db.conn.execute(
            r#"UPDATE "Reminder" SET "oneTimeAt" = ?2, "updatedAt" = ?3 WHERE "id" = ?1"#,
            params![id, until, now],
        )?;
        // 清掉 firedSet，讓新的 oneTimeAt 到了能再觸發
        db.clear_fired(id);
    } else {
        // 雲端版放記憶體（snoozeUntilMap），本機版存 DB；不改 updatedAt（雲端版也不會）
        db.conn.execute(
            r#"UPDATE "Reminder" SET "snoozeUntil" = ?2 WHERE "id" = ?1"#,
            params![id, until],
        )?;
    }
    Ok((200, json!({ "success": true })))
}

// ── /groups ─────────────────────────────────────────────────────────────────

fn validate_group_dto(dto: &Map<String, Value>) -> Result<String, ApiError> {
    let mut c = Checker::new();
    c.whitelist(dto, &["name"], "");
    let v = get(dto, "name").unwrap_or(&Value::Null);
    c.string("", "name", v);
    c.not_empty("", "name", v);
    c.length("", "name", v, 1, 60);
    c.finish()?;
    Ok(v.as_str().unwrap_or_default().to_string())
}

fn find_group(db: &LocalDb, id: &str) -> Result<GroupRow, ApiError> {
    db.conn
        .query_row(
            r#"SELECT "id", "name", "createdAt" FROM "Group" WHERE "id" = ?1"#,
            [id],
            |r| Ok(GroupRow { id: r.get(0)?, name: r.get(1)?, created_at: r.get(2)? }),
        )
        .optional()?
        .ok_or_else(|| not_found("群組不存在"))
}

fn group_id_by_name(db: &LocalDb, name: &str) -> Result<Option<String>, ApiError> {
    Ok(db
        .conn
        .query_row(r#"SELECT "id" FROM "Group" WHERE "name" = ?1"#, [name], |r| r.get(0))
        .optional()?)
}

fn groups_find_all(db: &LocalDb) -> ApiResult {
    let groups = local_store::load_groups(&db.conn)?;
    Ok((200, Value::Array(groups.iter().map(group_json).collect())))
}

fn groups_create(db: &mut LocalDb, dto: &Map<String, Value>, now: i64) -> ApiResult {
    let name = validate_group_dto(dto)?;
    if group_id_by_name(db, &name)?.is_some() {
        return Err(conflict("群組名稱已存在"));
    }
    let group = GroupRow { id: local_store::new_id(), name, created_at: now };
    db.conn.execute(
        r#"INSERT INTO "Group" ("id", "name", "createdAt") VALUES (?1, ?2, ?3)"#,
        params![group.id, group.name, group.created_at],
    )?;
    Ok((201, group_json(&group)))
}

fn groups_rename(db: &mut LocalDb, id: &str, dto: &Map<String, Value>) -> ApiResult {
    let name = validate_group_dto(dto)?;
    let mut group = find_group(db, id)?;
    if group_id_by_name(db, &name)?.is_some_and(|other| other != id) {
        return Err(conflict("群組名稱已存在"));
    }
    db.conn.execute(
        r#"UPDATE "Group" SET "name" = ?2 WHERE "id" = ?1"#,
        params![id, name],
    )?;
    group.name = name;
    Ok((200, group_json(&group)))
}

fn groups_remove(db: &mut LocalDb, id: &str) -> ApiResult {
    find_group(db, id)?;
    // 外鍵 ON DELETE SET NULL：提醒的 groupId 變成 null（歸入未分組）
    db.conn.execute(r#"DELETE FROM "Group" WHERE "id" = ?1"#, [id])?;
    Ok((200, json!({ "success": true })))
}

// ── /display-settings ───────────────────────────────────────────────────────

const SIZES: &[&str] = &["small", "medium", "large"];
const THEMES: &[&str] = &["light", "dark"];
const CORNERS: &[&str] = &["top_left", "top_right", "bottom_left", "bottom_right"];
const MASCOT_MODES: &[&str] = &["system", "custom"];
const MASCOT_ICONS: &[&str] = &["bell_ring", "sparkles", "calendar_clock"];

/// 不存在時自動建立預設值（同雲端版的 upsert）。
fn display_current(db: &LocalDb) -> Result<DisplayRow, ApiError> {
    if let Some(d) = local_store::load_display(&db.conn)? {
        return Ok(d);
    }
    db.conn.execute(
        r#"INSERT INTO "DisplaySetting" ("id") VALUES (?1)"#,
        [local_store::new_id()],
    )?;
    local_store::load_display(&db.conn)?.ok_or_else(internal)
}

fn display_get(db: &LocalDb) -> ApiResult {
    let d = display_current(db)?;
    Ok((200, display_json(&db.conn, &d)?))
}

fn display_update(db: &mut LocalDb, dto: &Map<String, Value>) -> ApiResult {
    let mut c = Checker::new();
    c.whitelist(
        dto,
        &["size", "theme", "corner", "showContent", "targetScreenId", "mascotMode", "mascotIcon"],
        "",
    );
    let enums: [(&str, &[&str]); 5] = [
        ("size", SIZES),
        ("theme", THEMES),
        ("corner", CORNERS),
        ("mascotMode", MASCOT_MODES),
        ("mascotIcon", MASCOT_ICONS),
    ];
    for (key, values) in enums {
        if let Some(v) = get(dto, key).filter(|v| !v.is_null()) {
            c.enumeration("", key, v, values);
        }
    }
    if let Some(v) = get(dto, "showContent").filter(|v| !v.is_null()) {
        c.boolean("", "showContent", v);
    }
    if let Some(v) = get(dto, "targetScreenId").filter(|v| !v.is_null()) {
        c.string("", "targetScreenId", v);
        c.max_length("", "targetScreenId", v, 100);
    }
    c.finish()?;

    // 雲端版用 `...dto` 直接寫進 Prisma：非 nullable 欄位給 null 會是 Prisma 例外 → 500
    for key in ["size", "theme", "corner", "showContent", "mascotMode", "mascotIcon"] {
        if matches!(get(dto, key), Some(Value::Null)) {
            return Err(internal());
        }
    }

    let mut d = display_current(db)?;
    if let Some(v) = opt_str(dto, "size") {
        d.size = v;
    }
    if let Some(v) = opt_str(dto, "theme") {
        d.theme = v;
    }
    if let Some(v) = opt_str(dto, "corner") {
        d.corner = v;
    }
    if let Some(v) = opt_bool(dto, "showContent") {
        d.show_content = v;
    }
    if let Some(v) = opt_str(dto, "mascotMode") {
        d.mascot_mode = v;
    }
    if let Some(v) = opt_str(dto, "mascotIcon") {
        d.mascot_icon = v;
    }
    // targetScreenId: dto !== undefined ? (dto || null) : current
    if get(dto, "targetScreenId").is_some() {
        d.target_screen_id = opt_str(dto, "targetScreenId").filter(|s| !s.is_empty());
    }
    db.conn.execute(
        r#"UPDATE "DisplaySetting" SET "size" = ?2, "theme" = ?3, "corner" = ?4, "showContent" = ?5,
               "targetScreenId" = ?6, "mascotMode" = ?7, "mascotIcon" = ?8
           WHERE "id" = ?1"#,
        params![
            d.id,
            d.size,
            d.theme,
            d.corner,
            d.show_content,
            d.target_screen_id,
            d.mascot_mode,
            d.mascot_icon
        ],
    )?;
    Ok((200, display_json(&db.conn, &d)?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::local_store::open_in_memory;

    const NOW: i64 = 1_779_242_400_000; // 2026-05-20T02:00:00.000Z

    fn db() -> LocalDb {
        LocalDb::new(open_in_memory().unwrap())
    }

    fn call(db: &mut LocalDb, method: &str, path: &str, body: Value) -> (u16, Value) {
        let raw = if body.is_null() { None } else { Some(body.to_string()) };
        handle(db, method, path, raw.as_deref(), NOW)
    }

    fn messages(body: &Value) -> Vec<String> {
        match &body["message"] {
            Value::Array(a) => a.iter().map(|m| m.as_str().unwrap().to_string()).collect(),
            Value::String(s) => vec![s.clone()],
            _ => vec![],
        }
    }

    fn create_one_time(db: &mut LocalDb, title: &str) -> Value {
        let (status, body) = call(
            db,
            "POST",
            "/reminders",
            json!({ "title": title, "scheduleType": "one_time", "oneTimeAt": "2026-05-20T03:00:00.000Z" }),
        );
        assert_eq!(status, 201, "{body}");
        body
    }

    fn create_group(db: &mut LocalDb, name: &str) -> Value {
        let (status, body) = call(db, "POST", "/groups", json!({ "name": name }));
        assert_eq!(status, 201, "{body}");
        body
    }

    // ── 路由 ────────────────────────────────────────────────────────────────

    #[test]
    fn unknown_route_is_404_like_nest() {
        let mut db = db();
        let (status, body) = call(&mut db, "GET", "/auth/me", Value::Null);
        assert_eq!(status, 404);
        assert_eq!(body, json!({ "message": "Cannot GET /auth/me", "error": "Not Found", "statusCode": 404 }));
        assert_eq!(call(&mut db, "PUT", "/reminders", Value::Null).0, 404);
        assert_eq!(call(&mut db, "GET", "/scheduler/due", Value::Null).0, 404);
    }

    #[test]
    fn trailing_slash_and_query_are_ignored() {
        let mut db = db();
        assert_eq!(call(&mut db, "GET", "/reminders/", Value::Null).0, 200);
        assert_eq!(call(&mut db, "get", "/groups?x=1", Value::Null).0, 200);
    }

    #[test]
    fn invalid_json_body_is_400() {
        let mut db = db();
        let (status, body) = handle(&mut db, "POST", "/groups", Some("{oops"), NOW);
        assert_eq!(status, 400);
        assert_eq!(body["statusCode"], 400);
        assert_eq!(body["error"], "Bad Request");
    }

    // ── POST /reminders ─────────────────────────────────────────────────────

    #[test]
    fn create_one_time_with_defaults() {
        let mut db = db();
        let body = create_one_time(&mut db, "喝水");
        assert_eq!(body["title"], "喝水");
        assert_eq!(body["content"], "");
        assert_eq!(body["enabled"], true);
        assert_eq!(body["scheduleType"], "one_time");
        assert_eq!(body["oneTimeAt"], "2026-05-20T03:00:00.000Z");
        assert_eq!(body["autoCloseEnabled"], false);
        assert_eq!(body["autoCloseSeconds"], 60);
        assert_eq!(body["snoozeDefaultSeconds"], 300);
        assert_eq!(body["sortOrder"], 0);
        assert_eq!(body["endAt"], Value::Null);
        assert_eq!(body["maxOccurrences"], Value::Null);
        assert_eq!(body["fireCount"], 0);
        assert_eq!(body["groupId"], Value::Null);
        assert_eq!(body["group"], Value::Null);
        assert_eq!(body["recurrenceRules"], json!([]));
        assert_eq!(body["createdAt"], "2026-05-20T02:00:00.000Z");
        assert!(body.get("userId").is_none());
        assert!(body.get("snoozeUntil").is_none());
        assert!(is_uuid(body["id"].as_str().unwrap()));
    }

    #[test]
    fn create_increments_sort_order() {
        let mut db = db();
        create_one_time(&mut db, "a");
        let b = create_one_time(&mut db, "b");
        assert_eq!(b["sortOrder"], 1);
    }

    #[test]
    fn create_recurring_with_rules_and_group() {
        let mut db = db();
        let group = create_group(&mut db, "工作");
        let (status, body) = call(
            &mut db,
            "POST",
            "/reminders",
            json!({
                "title": "週會",
                "content": "帶筆電",
                "scheduleType": "recurring",
                "recurrenceRules": [{ "ruleMode": "weekly_day", "weekDays": [1, 3], "timeOfDay": "09:00" }],
                "groupId": group["id"],
                "endAt": null,
                "maxOccurrences": null,
                "skipShortMonthConfirmation": false,
                "autoCloseEnabled": true,
                "autoCloseSeconds": 30,
                "snoozeDefaultSeconds": 120,
            }),
        );
        assert_eq!(status, 201, "{body}");
        assert_eq!(body["groupId"], group["id"]);
        assert_eq!(body["group"]["name"], "工作");
        let rule = &body["recurrenceRules"][0];
        assert_eq!(rule["ruleMode"], "weekly_day");
        assert_eq!(rule["weekDays"], json!([1, 3]));
        assert_eq!(rule["timeOfDay"], "09:00");
        assert_eq!(rule["monthDay"], Value::Null);
        assert_eq!(rule["reminderId"], body["id"]);
        assert_eq!(body["autoCloseSeconds"], 30);
    }

    #[test]
    fn create_rejects_unknown_property_and_bad_types() {
        let mut db = db();
        let (status, body) = call(
            &mut db,
            "POST",
            "/reminders",
            json!({ "title": "", "scheduleType": "weekly", "foo": 1, "autoCloseSeconds": 1.5, "snoozeDefaultSeconds": 30 }),
        );
        assert_eq!(status, 400);
        assert_eq!(body["error"], "Bad Request");
        let msgs = messages(&body);
        assert!(msgs.contains(&"property foo should not exist".to_string()), "{msgs:?}");
        assert!(msgs.contains(&"title should not be empty".to_string()));
        assert!(msgs.contains(&"title must be longer than or equal to 1 characters".to_string()));
        assert!(msgs.contains(&"scheduleType must be one of the following values: one_time, recurring".to_string()));
        assert!(msgs.contains(&"autoCloseSeconds must be an integer number".to_string()));
        assert!(msgs.contains(&"snoozeDefaultSeconds must not be less than 60".to_string()));
    }

    #[test]
    fn create_requires_title_and_schedule_type() {
        let mut db = db();
        let (status, body) = call(&mut db, "POST", "/reminders", json!({}));
        assert_eq!(status, 400);
        let msgs = messages(&body);
        assert!(msgs.contains(&"title must be a string".to_string()));
        assert!(msgs.iter().any(|m| m.starts_with("scheduleType must be one of")));
    }

    #[test]
    fn create_title_length_limit_counts_characters() {
        let mut db = db();
        let ok = "提".repeat(120);
        let (status, _) = call(&mut db, "POST", "/reminders", json!({ "title": ok, "scheduleType": "one_time", "oneTimeAt": "2026-05-20T03:00:00Z" }));
        assert_eq!(status, 201);
        let (status, body) = call(&mut db, "POST", "/reminders", json!({ "title": "提".repeat(121), "scheduleType": "one_time", "oneTimeAt": "2026-05-20T03:00:00Z" }));
        assert_eq!(status, 400);
        assert!(messages(&body).contains(&"title must be shorter than or equal to 120 characters".to_string()));
    }

    #[test]
    fn create_validates_nested_rules() {
        let mut db = db();
        let (status, body) = call(
            &mut db,
            "POST",
            "/reminders",
            json!({
                "title": "t",
                "scheduleType": "recurring",
                "recurrenceRules": [
                    { "ruleMode": "nope", "weekDays": [7, 1.5], "timeOfDay": "9:00", "intervalMinutes": 0, "bar": true },
                    1, 2, 3
                ],
            }),
        );
        assert_eq!(status, 400);
        let msgs = messages(&body);
        assert!(msgs.contains(&"recurrenceRules must contain no more than 3 elements".to_string()), "{msgs:?}");
        assert!(msgs.iter().any(|m| m.starts_with("recurrenceRules.0.ruleMode must be one of")));
        assert!(msgs.contains(&"recurrenceRules.0.each value in weekDays must not be greater than 6".to_string()));
        assert!(msgs.contains(&"recurrenceRules.0.each value in weekDays must be an integer number".to_string()));
        assert!(msgs.contains(&"recurrenceRules.0.timeOfDay must be longer than or equal to 5 characters".to_string()));
        assert!(msgs.contains(&"recurrenceRules.0.intervalMinutes must not be less than 1".to_string()));
        assert!(msgs.contains(&"recurrenceRules.0.property bar should not exist".to_string()));
        assert!(msgs.contains(&"nested property recurrenceRules must be either object or array".to_string()));
    }

    #[test]
    fn create_validates_dates() {
        let mut db = db();
        let (status, body) = call(&mut db, "POST", "/reminders", json!({ "title": "t", "scheduleType": "one_time", "oneTimeAt": "tomorrow" }));
        assert_eq!(status, 400);
        assert!(messages(&body).contains(&"oneTimeAt must be a valid ISO 8601 date string".to_string()));
    }

    // validateReminderInput（reminders.service.ts）
    #[test]
    fn cross_field_validation_messages() {
        let mut db = db();
        let cases = [
            (json!({ "title": "t", "scheduleType": "one_time" }), "單次提醒必須提供 oneTimeAt"),
            (json!({ "title": "t", "scheduleType": "recurring" }), "重複提醒必須至少提供一條 recurrenceRules"),
            (json!({ "title": "t", "scheduleType": "recurring", "recurrenceRules": [] }), "重複提醒必須至少提供一條 recurrenceRules"),
            (json!({ "title": "t", "scheduleType": "recurring", "recurrenceRules": [{ "ruleMode": "daily_time" }] }), "daily_time 必須提供 timeOfDay"),
            (json!({ "title": "t", "scheduleType": "recurring", "recurrenceRules": [{ "ruleMode": "weekly_day", "timeOfDay": "09:00" }] }), "weekly_day 必須選擇至少一個星期"),
            (json!({ "title": "t", "scheduleType": "recurring", "recurrenceRules": [{ "ruleMode": "weekly_day", "weekDays": [1] }] }), "weekly_day 必須提供 timeOfDay"),
            (json!({ "title": "t", "scheduleType": "recurring", "recurrenceRules": [{ "ruleMode": "monthly_day", "timeOfDay": "09:00" }] }), "monthly_day 必須提供 monthDay"),
            (json!({ "title": "t", "scheduleType": "recurring", "recurrenceRules": [{ "ruleMode": "monthly_day", "monthDay": 5 }] }), "monthly_day 必須提供 timeOfDay"),
            (json!({ "title": "t", "scheduleType": "recurring", "recurrenceRules": [{ "ruleMode": "interval" }] }), "interval 必須提供 intervalMinutes（1~1440 分鐘）"),
            (json!({ "title": "t", "scheduleType": "recurring", "recurrenceRules": [{ "ruleMode": "interval", "intervalMinutes": 30, "activeFrom": "09:00" }] }), "interval 限定時段需同時提供 activeFrom 與 activeUntil"),
            (json!({ "title": "t", "scheduleType": "recurring", "recurrenceRules": [{ "ruleMode": "interval", "intervalMinutes": 30, "activeFrom": "23:00", "activeUntil": "01:00" }] }), "interval activeFrom 必須早於 activeUntil（不支援跨夜）"),
        ];
        for (body, expected) in cases {
            let (status, res) = call(&mut db, "POST", "/reminders", body.clone());
            assert_eq!(status, 400, "{body}");
            assert_eq!(res, json!({ "message": expected, "error": "Bad Request", "statusCode": 400 }));
        }
        // 單次提醒不檢查 recurrenceRules 的內容
        let (status, _) = call(
            &mut db,
            "POST",
            "/reminders",
            json!({ "title": "t", "scheduleType": "one_time", "oneTimeAt": "2026-05-20T03:00:00Z", "recurrenceRules": [{ "ruleMode": "daily_time" }] }),
        );
        assert_eq!(status, 201);
    }

    #[test]
    fn short_month_requires_confirmation() {
        let mut db = db();
        let body = json!({
            "title": "月底",
            "scheduleType": "recurring",
            "recurrenceRules": [{ "ruleMode": "monthly_day", "monthDay": 31, "timeOfDay": "09:00" }],
        });
        let (status, res) = call(&mut db, "POST", "/reminders", body.clone());
        assert_eq!(status, 409);
        assert_eq!(
            res,
            json!({
                "code": "SHORT_MONTH_CONFIRMATION_REQUIRED",
                "message": "若遇到沒有該日期的月份，此月份將跳過提醒，是否確定繼續？",
            })
        );
        let mut confirmed = body.clone();
        confirmed["skipShortMonthConfirmation"] = json!(true);
        let (status, created) = call(&mut db, "POST", "/reminders", confirmed);
        assert_eq!(status, 201);

        // 已經確認過的日期，更新時不用再確認；換成別的 29–31 號要重新確認
        let id = created["id"].as_str().unwrap();
        let (status, _) = call(&mut db, "PATCH", &format!("/reminders/{id}"), json!({ "title": "月底 2" }));
        assert_eq!(status, 200);
        let (status, _) = call(
            &mut db,
            "PATCH",
            &format!("/reminders/{id}"),
            json!({ "recurrenceRules": [{ "ruleMode": "monthly_day", "monthDay": 30, "timeOfDay": "09:00" }] }),
        );
        assert_eq!(status, 409);
    }

    #[test]
    fn create_with_missing_group_is_404() {
        let mut db = db();
        let (status, body) = call(
            &mut db,
            "POST",
            "/reminders",
            json!({ "title": "t", "scheduleType": "one_time", "oneTimeAt": "2026-05-20T03:00:00Z", "groupId": "missing" }),
        );
        assert_eq!(status, 404);
        assert_eq!(body, json!({ "message": "指定的群組不存在", "error": "Not Found", "statusCode": 404 }));
        assert_eq!(call(&mut db, "GET", "/reminders", Value::Null).1, json!([]));
    }

    #[test]
    fn local_datetime_without_offset_uses_system_local_time() {
        let mut db = db();
        let (status, body) = call(
            &mut db,
            "POST",
            "/reminders",
            json!({ "title": "t", "scheduleType": "one_time", "oneTimeAt": "2026-05-20T10:00:00.000Z", "endAt": "2026-06-01T18:30" }),
        );
        assert_eq!(status, 201);
        let expected = Local
            .with_ymd_and_hms(2026, 6, 1, 18, 30, 0)
            .earliest()
            .unwrap()
            .timestamp_millis();
        assert_eq!(body["endAt"], to_iso(expected));
    }

    // ── GET /reminders ──────────────────────────────────────────────────────

    #[test]
    fn find_all_orders_by_sort_order() {
        let mut db = db();
        let a = create_one_time(&mut db, "a");
        let b = create_one_time(&mut db, "b");
        let (status, _) = call(
            &mut db,
            "POST",
            "/reminders/reorder",
            json!({ "items": [{ "id": a["id"], "sortOrder": 5 }, { "id": b["id"], "sortOrder": 1 }] }),
        );
        assert_eq!(status, 201);
        let (status, list) = call(&mut db, "GET", "/reminders", Value::Null);
        assert_eq!(status, 200);
        let titles: Vec<_> = list.as_array().unwrap().iter().map(|r| r["title"].as_str().unwrap()).collect();
        assert_eq!(titles, vec!["b", "a"]);
    }

    #[test]
    fn find_one_404() {
        let mut db = db();
        let (status, body) = call(&mut db, "GET", "/reminders/nope", Value::Null);
        assert_eq!(status, 404);
        assert_eq!(body, json!({ "message": "提醒不存在", "error": "Not Found", "statusCode": 404 }));
        let created = create_one_time(&mut db, "a");
        let (status, body) = call(&mut db, "GET", &format!("/reminders/{}", created["id"].as_str().unwrap()), Value::Null);
        assert_eq!(status, 200);
        assert_eq!(body, created);
    }

    // ── PATCH /reminders/:id ────────────────────────────────────────────────

    #[test]
    fn update_merges_and_resets_state() {
        let mut db = db();
        let group = create_group(&mut db, "g");
        let (_, created) = call(
            &mut db,
            "POST",
            "/reminders",
            json!({
                "title": "t",
                "scheduleType": "recurring",
                "maxOccurrences": 3,
                "groupId": group["id"],
                "recurrenceRules": [{ "ruleMode": "daily_time", "timeOfDay": "09:00" }],
            }),
        );
        let id = created["id"].as_str().unwrap().to_string();
        db.conn
            .execute(r#"UPDATE "Reminder" SET "fireCount" = 2, "snoozeUntil" = 1 WHERE "id" = ?1"#, [&id])
            .unwrap();
        db.fired.insert(format!("{id}-2026-05-20-09:00"), NOW);

        let (status, body) = call(&mut db, "PATCH", &format!("/reminders/{id}"), json!({ "content": "新內容" }));
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["title"], "t");
        assert_eq!(body["content"], "新內容");
        assert_eq!(body["maxOccurrences"], 3);
        assert_eq!(body["groupId"], group["id"]);
        assert_eq!(body["fireCount"], 0, "resetReminder 會把 fireCount 歸零");
        assert_eq!(body["recurrenceRules"].as_array().unwrap().len(), 1);
        assert!(db.fired.is_empty());
        let snooze: Option<i64> = db
            .conn
            .query_row(r#"SELECT "snoozeUntil" FROM "Reminder" WHERE "id" = ?1"#, [&id], |r| r.get(0))
            .unwrap();
        assert_eq!(snooze, None);

        // null 清掉 maxOccurrences / groupId；recurrenceRules 整批替換
        let (status, body) = call(
            &mut db,
            "PATCH",
            &format!("/reminders/{id}"),
            json!({
                "maxOccurrences": null,
                "groupId": null,
                "recurrenceRules": [{ "ruleMode": "interval", "intervalMinutes": 30, "weekDays": [1, 2] }],
            }),
        );
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["maxOccurrences"], Value::Null);
        assert_eq!(body["groupId"], Value::Null);
        assert_eq!(body["group"], Value::Null);
        let rules = body["recurrenceRules"].as_array().unwrap();
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0]["ruleMode"], "interval");
        assert_eq!(rules[0]["weekDays"], json!([1, 2]));
    }

    #[test]
    fn update_switch_to_one_time_requires_one_time_at() {
        let mut db = db();
        let (_, created) = call(
            &mut db,
            "POST",
            "/reminders",
            json!({ "title": "t", "scheduleType": "recurring", "recurrenceRules": [{ "ruleMode": "daily_time", "timeOfDay": "09:00" }] }),
        );
        let path = format!("/reminders/{}", created["id"].as_str().unwrap());
        let (status, body) = call(&mut db, "PATCH", &path, json!({ "scheduleType": "one_time" }));
        assert_eq!(status, 400);
        assert_eq!(body["message"], "單次提醒必須提供 oneTimeAt");
        let (status, body) = call(&mut db, "PATCH", &path, json!({ "scheduleType": "one_time", "oneTimeAt": "2026-05-21T00:00:00Z" }));
        assert_eq!(status, 200);
        assert_eq!(body["oneTimeAt"], "2026-05-21T00:00:00.000Z");
        // 原本的規則留著（雲端版也不會刪）
        assert_eq!(body["recurrenceRules"].as_array().unwrap().len(), 1);
        // oneTimeAt: null 清掉 → 單次提醒沒有時間 → 400
        let (status, _) = call(&mut db, "PATCH", &path, json!({ "oneTimeAt": null }));
        assert_eq!(status, 400);
    }

    #[test]
    fn update_errors() {
        let mut db = db();
        let created = create_one_time(&mut db, "a");
        let path = format!("/reminders/{}", created["id"].as_str().unwrap());
        assert_eq!(call(&mut db, "PATCH", "/reminders/nope", json!({ "title": "x" })).0, 404);
        // DTO 驗證在找資料之前（ValidationPipe 先跑）
        assert_eq!(call(&mut db, "PATCH", "/reminders/nope", json!({ "id": "x" })).0, 400);
        let (status, body) = call(&mut db, "PATCH", &path, json!({ "groupId": "missing" }));
        assert_eq!(status, 404);
        assert_eq!(body["message"], "指定的群組不存在");
        // title: null 在 PartialType 下是允許的，等同沒給
        let (status, body) = call(&mut db, "PATCH", &path, json!({ "title": null }));
        assert_eq!(status, 200);
        assert_eq!(body["title"], "a");
        // recurrenceRules: null 在雲端會 500
        assert_eq!(call(&mut db, "PATCH", &path, json!({ "recurrenceRules": null })).0, 500);
    }

    // ── DELETE / enable / disable ───────────────────────────────────────────

    #[test]
    fn delete_and_toggle() {
        let mut db = db();
        let created = create_one_time(&mut db, "a");
        let id = created["id"].as_str().unwrap();
        let (status, body) = call(&mut db, "PATCH", &format!("/reminders/{id}/disable"), Value::Null);
        assert_eq!(status, 200);
        assert_eq!(body["enabled"], false);
        let (status, body) = call(&mut db, "PATCH", &format!("/reminders/{id}/enable"), Value::Null);
        assert_eq!(status, 200);
        assert_eq!(body["enabled"], true);
        assert_eq!(call(&mut db, "PATCH", "/reminders/nope/enable", Value::Null).0, 404);

        let (status, body) = call(&mut db, "DELETE", &format!("/reminders/{id}"), Value::Null);
        assert_eq!(status, 200);
        assert_eq!(body, json!({ "success": true }));
        assert_eq!(call(&mut db, "DELETE", &format!("/reminders/{id}"), Value::Null).0, 404);
    }

    #[test]
    fn delete_cascades_rules() {
        let mut db = db();
        let (_, created) = call(
            &mut db,
            "POST",
            "/reminders",
            json!({ "title": "t", "scheduleType": "recurring", "recurrenceRules": [{ "ruleMode": "daily_time", "timeOfDay": "09:00" }] }),
        );
        call(&mut db, "DELETE", &format!("/reminders/{}", created["id"].as_str().unwrap()), Value::Null);
        let rules: i64 = db.conn.query_row(r#"SELECT COUNT(*) FROM "RecurrenceRule""#, [], |r| r.get(0)).unwrap();
        assert_eq!(rules, 0);
    }

    // ── POST /reminders/reorder ─────────────────────────────────────────────

    #[test]
    fn reorder_validation_and_404() {
        let mut db = db();
        let a = create_one_time(&mut db, "a");
        let (status, body) = call(&mut db, "POST", "/reminders/reorder", json!({ "items": [{ "id": "x", "sortOrder": -1 }] }));
        assert_eq!(status, 400);
        let msgs = messages(&body);
        assert!(msgs.contains(&"items.0.id must be a UUID".to_string()), "{msgs:?}");
        assert!(msgs.contains(&"items.0.sortOrder must not be less than 0".to_string()));
        assert_eq!(call(&mut db, "POST", "/reminders/reorder", json!({})).0, 400);

        let (status, body) = call(
            &mut db,
            "POST",
            "/reminders/reorder",
            json!({ "items": [{ "id": a["id"], "sortOrder": 0 }, { "id": "00000000-0000-4000-8000-000000000000", "sortOrder": 1 }] }),
        );
        assert_eq!(status, 404);
        assert_eq!(body["message"], "排序資料包含不存在的提醒 id");
        // 同一個 id 出現兩次不算不存在
        let (status, _) = call(
            &mut db,
            "POST",
            "/reminders/reorder",
            json!({ "items": [{ "id": a["id"], "sortOrder": 3 }, { "id": a["id"], "sortOrder": 4 }] }),
        );
        assert_eq!(status, 201);
    }

    // ── PATCH /reminders/:id/snooze ─────────────────────────────────────────

    #[test]
    fn snooze_one_time_moves_one_time_at() {
        let mut db = db();
        let created = create_one_time(&mut db, "a");
        let id = created["id"].as_str().unwrap();
        db.fired.insert(format!("{id}-one_time"), NOW);
        let (status, body) = call(&mut db, "PATCH", &format!("/reminders/{id}/snooze"), json!({ "seconds": 300 }));
        assert_eq!(status, 200);
        assert_eq!(body, json!({ "success": true }));
        let (_, r) = call(&mut db, "GET", &format!("/reminders/{id}"), Value::Null);
        assert_eq!(r["oneTimeAt"], to_iso(NOW + 300_000));
        assert!(db.fired.is_empty());
    }

    #[test]
    fn snooze_recurring_stores_snooze_until() {
        let mut db = db();
        let (_, created) = call(
            &mut db,
            "POST",
            "/reminders",
            json!({ "title": "t", "scheduleType": "recurring", "recurrenceRules": [{ "ruleMode": "daily_time", "timeOfDay": "09:00" }] }),
        );
        let id = created["id"].as_str().unwrap();
        let (status, _) = call(&mut db, "PATCH", &format!("/reminders/{id}/snooze"), json!({ "seconds": 60 }));
        assert_eq!(status, 200);
        let until: Option<i64> = db
            .conn
            .query_row(r#"SELECT "snoozeUntil" FROM "Reminder" WHERE "id" = ?1"#, [id], |r| r.get(0))
            .unwrap();
        assert_eq!(until, Some(NOW + 60_000));
    }

    #[test]
    fn snooze_validation_and_404() {
        let mut db = db();
        let (status, body) = call(&mut db, "PATCH", "/reminders/nope/snooze", json!({ "seconds": 0 }));
        assert_eq!(status, 400);
        assert_eq!(messages(&body), vec!["seconds must not be less than 1".to_string()]);
        assert_eq!(call(&mut db, "PATCH", "/reminders/nope/snooze", json!({})).0, 400);
        assert_eq!(call(&mut db, "PATCH", "/reminders/nope/snooze", json!({ "seconds": 60 })).0, 404);
    }

    // ── /groups ─────────────────────────────────────────────────────────────

    #[test]
    fn groups_crud() {
        let mut db = db();
        let g = create_group(&mut db, "工作");
        assert_eq!(g["name"], "工作");
        assert_eq!(g["createdAt"], "2026-05-20T02:00:00.000Z");
        assert!(g.get("userId").is_none());

        let (status, body) = call(&mut db, "POST", "/groups", json!({ "name": "工作" }));
        assert_eq!(status, 409);
        assert_eq!(body, json!({ "message": "群組名稱已存在", "error": "Conflict", "statusCode": 409 }));

        let other = create_group(&mut db, "家庭");
        let id = g["id"].as_str().unwrap();
        assert_eq!(call(&mut db, "PATCH", &format!("/groups/{id}"), json!({ "name": "家庭" })).0, 409);
        // 改成自己原本的名字不算重複
        assert_eq!(call(&mut db, "PATCH", &format!("/groups/{id}"), json!({ "name": "工作" })).0, 200);
        let (status, body) = call(&mut db, "PATCH", &format!("/groups/{id}"), json!({ "name": "公司" }));
        assert_eq!(status, 200);
        assert_eq!(body["name"], "公司");
        assert_eq!(body["id"], g["id"]);

        let (status, list) = call(&mut db, "GET", "/groups", Value::Null);
        assert_eq!(status, 200);
        assert_eq!(list.as_array().unwrap().len(), 2);
        assert_eq!(list[1]["id"], other["id"]);

        assert_eq!(call(&mut db, "PATCH", "/groups/nope", json!({ "name": "x" })).0, 404);
        let (status, body) = call(&mut db, "DELETE", "/groups/nope", Value::Null);
        assert_eq!(status, 404);
        assert_eq!(body["message"], "群組不存在");
    }

    #[test]
    fn group_validation() {
        let mut db = db();
        let (status, body) = call(&mut db, "POST", "/groups", json!({ "name": "", "x": 1 }));
        assert_eq!(status, 400);
        let msgs = messages(&body);
        assert!(msgs.contains(&"name should not be empty".to_string()));
        assert!(msgs.contains(&"property x should not exist".to_string()));
        let (status, body) = call(&mut db, "POST", "/groups", json!({ "name": "a".repeat(61) }));
        assert_eq!(status, 400);
        assert!(messages(&body).contains(&"name must be shorter than or equal to 60 characters".to_string()));
        // 驗證在找群組之前
        assert_eq!(call(&mut db, "PATCH", "/groups/nope", json!({})).0, 400);
    }

    #[test]
    fn deleting_group_ungroups_reminders() {
        let mut db = db();
        let g = create_group(&mut db, "g");
        let (_, r) = call(
            &mut db,
            "POST",
            "/reminders",
            json!({ "title": "t", "scheduleType": "one_time", "oneTimeAt": "2026-05-20T03:00:00Z", "groupId": g["id"] }),
        );
        let (status, body) = call(&mut db, "DELETE", &format!("/groups/{}", g["id"].as_str().unwrap()), Value::Null);
        assert_eq!(status, 200);
        assert_eq!(body, json!({ "success": true }));
        let (_, after) = call(&mut db, "GET", &format!("/reminders/{}", r["id"].as_str().unwrap()), Value::Null);
        assert_eq!(after["groupId"], Value::Null);
        assert_eq!(after["group"], Value::Null);
    }

    // ── /display-settings ───────────────────────────────────────────────────

    #[test]
    fn display_settings_defaults_and_update() {
        let mut db = db();
        let (status, body) = call(&mut db, "GET", "/display-settings/current", Value::Null);
        assert_eq!(status, 200);
        assert_eq!(body["size"], "medium");
        assert_eq!(body["theme"], "light");
        assert_eq!(body["corner"], "bottom_right");
        assert_eq!(body["showContent"], true);
        assert_eq!(body["targetScreenId"], Value::Null);
        assert_eq!(body["mascotMode"], "system");
        assert_eq!(body["mascotIcon"], "bell_ring");
        assert_eq!(body["mascotImages"], json!([]));
        let id = body["id"].clone();
        // 第二次讀同一份
        assert_eq!(call(&mut db, "GET", "/display-settings/current", Value::Null).1["id"], id);

        let (status, body) = call(
            &mut db,
            "PATCH",
            "/display-settings/current",
            json!({ "size": "large", "theme": "dark", "corner": "top_left", "showContent": false, "targetScreenId": "Monitor #2", "mascotMode": "custom", "mascotIcon": "sparkles" }),
        );
        assert_eq!(status, 200, "{body}");
        assert_eq!(body["size"], "large");
        assert_eq!(body["targetScreenId"], "Monitor #2");
        assert_eq!(body["mascotIcon"], "sparkles");
        assert_eq!(body["id"], id);

        // 空字串清掉 targetScreenId（前端存檔時沒選螢幕就送 ''）
        let (_, body) = call(&mut db, "PATCH", "/display-settings/current", json!({ "targetScreenId": "" }));
        assert_eq!(body["targetScreenId"], Value::Null);
        assert_eq!(body["size"], "large");
    }

    // update-display-setting.dto.spec.ts
    #[test]
    fn display_settings_validation() {
        let mut db = db();
        for icon in ["bell_ring", "sparkles", "calendar_clock"] {
            assert_eq!(call(&mut db, "PATCH", "/display-settings/current", json!({ "mascotIcon": icon })).0, 200);
        }
        assert_eq!(call(&mut db, "PATCH", "/display-settings/current", json!({})).0, 200);
        let (status, body) = call(&mut db, "PATCH", "/display-settings/current", json!({ "mascotIcon": "invalid_value" }));
        assert_eq!(status, 400);
        assert!(messages(&body).iter().any(|m| m.starts_with("mascotIcon must be one of")));
        let (status, body) = call(&mut db, "PATCH", "/display-settings/current", json!({ "targetScreenId": "x".repeat(101), "showContent": "yes", "userId": "u" }));
        assert_eq!(status, 400);
        let msgs = messages(&body);
        assert!(msgs.contains(&"targetScreenId must be shorter than or equal to 100 characters".to_string()));
        assert!(msgs.contains(&"showContent must be a boolean value".to_string()));
        assert!(msgs.contains(&"property userId should not exist".to_string()));
        assert_eq!(call(&mut db, "PATCH", "/display-settings/current", json!({ "size": null })).0, 500);
    }

    // ── 日期與 UUID ─────────────────────────────────────────────────────────

    #[test]
    fn parse_js_date_matches_v8() {
        let utc = |s: &str| parse_js_date(s);
        assert_eq!(utc("2026-05-20T02:00:00.123Z"), Some(1779242400123));
        assert_eq!(utc("2026-05-20T10:00:00.123456Z"), Some(1779271200123));
        assert_eq!(utc("2026-05-20T10:00+08:00"), Some(1779242400000));
        assert_eq!(utc("2026-05-20T10:00+0800"), Some(1779242400000));
        assert_eq!(utc("2026-05-20"), Some(1779235200000));
        assert_eq!(utc("2026-05"), utc("2026-05-01"));
        assert_eq!(utc("2026"), utc("2026-01-01"));
        assert_eq!(utc("2026-02-30"), utc("2026-03-02"));
        assert_eq!(utc("2026-05-20T24:00Z"), utc("2026-05-21T00:00Z"));
        for bad in ["", "tomorrow", "2026-13-01", "20260520", "2026-W21", "2026-05-20T10", "2026-05-20T10:00+08", "2026-05-20t10:00z", "2026-05-20Z"] {
            assert_eq!(parse_js_date(bad), None, "{bad}");
        }
        let local = Local.with_ymd_and_hms(2026, 5, 20, 10, 0, 0).earliest().unwrap().timestamp_millis();
        assert_eq!(parse_js_date("2026-05-20T10:00"), Some(local));
        assert_eq!(parse_js_date("2026-05-20 10:00"), Some(local));
    }

    #[test]
    fn uuid_matches_validator_js() {
        assert!(is_uuid("a870103f-fe1a-4017-8ed4-7648d527da88"));
        assert!(is_uuid("00000000-0000-0000-0000-000000000000"));
        assert!(is_uuid("A870103F-FE1A-4017-8ED4-7648D527DA88"));
        assert!(!is_uuid("a870103f-fe1a-9017-8ed4-7648d527da88"));
        assert!(!is_uuid("a870103f-fe1a-4017-1ed4-7648d527da88"));
        assert!(!is_uuid("not-a-uuid"));
    }
}
