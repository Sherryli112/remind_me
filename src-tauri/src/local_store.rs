// src-tauri/src/local_store.rs
//
// 本機模式（沒有登入）的資料庫：{app_data_dir}/local.db。
//
// - 資料表跟雲端 schema（backend/prisma/schema.prisma）相同，但沒有 User / RefreshToken，
//   也沒有 userId 欄位；weekDays 用 JSON 字串存（SQLite 沒有陣列）。
// - DateTime 一律存 Unix 毫秒（INTEGER），跟舊版 sidecar 的 Prisma + SQLite 存法一樣。
// - Reminder 多一個 snoozeUntil 欄位：雲端版把延後狀態放在記憶體，本機版存 DB，重開 App 不會遺失。
//   這個欄位不會出現在 API 回應裡。
// - 用 PRAGMA user_version 做 schema 版本，啟動時跑內建 migration。
// - 第一次啟動（local.db 不存在）時，若有舊版 sidecar 留下的 remindme.db，就把資料匯入，
//   成功後把舊檔改名成 remindme.db.imported（不刪除）。匯入失敗只記 log，不阻擋啟動。

use chrono::{DateTime, NaiveDate, NaiveDateTime, SecondsFormat, TimeZone, Utc};
use rusqlite::types::Value as SqlValue;
use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

pub const LOCAL_DB_FILE: &str = "local.db";
pub const LEGACY_DB_FILE: &str = "remindme.db";
pub const LEGACY_IMPORTED_FILE: &str = "remindme.db.imported";

/// 依序套用的 migration；索引 i 的 SQL 會把 user_version 從 i 升到 i + 1。
const MIGRATIONS: &[&str] = &[r#"
CREATE TABLE "Group" (
    "id"        TEXT    NOT NULL PRIMARY KEY,
    "name"      TEXT    NOT NULL UNIQUE,
    "createdAt" INTEGER NOT NULL
);

CREATE TABLE "Reminder" (
    "id"                   TEXT    NOT NULL PRIMARY KEY,
    "title"                TEXT    NOT NULL,
    "content"              TEXT    NOT NULL DEFAULT '',
    "enabled"              INTEGER NOT NULL DEFAULT 1,
    "scheduleType"         TEXT    NOT NULL DEFAULT 'one_time',
    "oneTimeAt"            INTEGER,
    "autoCloseEnabled"     INTEGER NOT NULL DEFAULT 0,
    "autoCloseSeconds"     INTEGER NOT NULL DEFAULT 60,
    "snoozeDefaultSeconds" INTEGER NOT NULL DEFAULT 300,
    "sortOrder"            INTEGER NOT NULL DEFAULT 0,
    "endAt"                INTEGER,
    "maxOccurrences"       INTEGER,
    "fireCount"            INTEGER NOT NULL DEFAULT 0,
    "groupId"              TEXT REFERENCES "Group" ("id") ON DELETE SET NULL,
    "snoozeUntil"          INTEGER,
    "createdAt"            INTEGER NOT NULL,
    "updatedAt"            INTEGER NOT NULL
);
CREATE INDEX "Reminder_groupId_idx" ON "Reminder" ("groupId");

CREATE TABLE "RecurrenceRule" (
    "id"              TEXT NOT NULL PRIMARY KEY,
    "ruleMode"        TEXT NOT NULL,
    "monthDay"        INTEGER,
    "weekDays"        TEXT NOT NULL DEFAULT '[]',
    "timeOfDay"       TEXT,
    "intervalMinutes" INTEGER,
    "activeFrom"      TEXT,
    "activeUntil"     TEXT,
    "reminderId"      TEXT NOT NULL REFERENCES "Reminder" ("id") ON DELETE CASCADE
);
CREATE INDEX "RecurrenceRule_reminderId_idx" ON "RecurrenceRule" ("reminderId");

CREATE TABLE "DisplaySetting" (
    "id"             TEXT    NOT NULL PRIMARY KEY,
    "size"           TEXT    NOT NULL DEFAULT 'medium',
    "theme"          TEXT    NOT NULL DEFAULT 'light',
    "corner"         TEXT    NOT NULL DEFAULT 'bottom_right',
    "showContent"    INTEGER NOT NULL DEFAULT 1,
    "targetScreenId" TEXT,
    "mascotMode"     TEXT    NOT NULL DEFAULT 'system',
    "mascotIcon"     TEXT    NOT NULL DEFAULT 'bell_ring'
);

CREATE TABLE "MascotImage" (
    "id"               TEXT    NOT NULL PRIMARY KEY,
    "filePath"         TEXT    NOT NULL,
    "mimeType"         TEXT    NOT NULL,
    "width"            INTEGER NOT NULL,
    "height"           INTEGER NOT NULL,
    "sizeBytes"        INTEGER NOT NULL,
    "displaySettingId" TEXT    NOT NULL REFERENCES "DisplaySetting" ("id") ON DELETE CASCADE
);
"#];

/// 本機資料庫連線 + 本機排程器的記憶體狀態（firedSet）。
/// 放在同一把鎖裡：local_api 改提醒時要順便清 firedSet，排程器掃描時也要同時讀寫兩者。
pub struct LocalDb {
    pub conn: Connection,
    /// key: `${reminderId}-${windowKey}`，value: 觸發時間（ms）。跟雲端 SchedulerService 的 firedSet 相同。
    pub fired: HashMap<String, i64>,
}

impl LocalDb {
    pub fn new(conn: Connection) -> Self {
        Self {
            conn,
            fired: HashMap::new(),
        }
    }

    pub fn clear_fired(&mut self, reminder_id: &str) {
        let prefix = format!("{reminder_id}-");
        self.fired.retain(|k, _| !k.starts_with(&prefix));
    }
}

/// Tauri managed state。開檔失敗時是 None，local_api 回 500（不讓整個 App 起不來）。
pub struct LocalStore(pub Mutex<Option<LocalDb>>);

// ── 時間 ────────────────────────────────────────────────────────────────────

pub fn now_ms() -> i64 {
    Utc::now().timestamp_millis()
}

/// 跟 JavaScript 的 Date#toISOString 相同格式：`2026-05-20T02:00:00.000Z`
pub fn to_iso(ms: i64) -> String {
    match Utc.timestamp_millis_opt(ms).single() {
        Some(dt) => dt.to_rfc3339_opts(SecondsFormat::Millis, true),
        None => "1970-01-01T00:00:00.000Z".to_string(),
    }
}

// ── 開檔與 migration ────────────────────────────────────────────────────────

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let mut conn = Connection::open(path)?;
    configure_and_migrate(&mut conn)?;
    Ok(conn)
}

#[cfg(test)]
pub fn open_in_memory() -> rusqlite::Result<Connection> {
    let mut conn = Connection::open_in_memory()?;
    configure_and_migrate(&mut conn)?;
    Ok(conn)
}

fn configure_and_migrate(conn: &mut Connection) -> rusqlite::Result<()> {
    conn.pragma_update(None, "foreign_keys", "ON")?;
    // 多個視窗同時呼叫 local_api 時都經過同一把 Mutex，不會有並行寫入；busy_timeout 只是保險
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    migrate(conn)
}

pub fn migrate(conn: &mut Connection) -> rusqlite::Result<()> {
    let version: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
    for (i, sql) in MIGRATIONS.iter().enumerate() {
        let target = i as i64 + 1;
        if version >= target {
            continue;
        }
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", target)?;
        tx.commit()?;
    }
    Ok(())
}

/// App 啟動時呼叫：必要時先匯入舊版資料，再開啟 local.db。
pub fn open_for_app(data_dir: &Path) -> rusqlite::Result<Connection> {
    let local_path = data_dir.join(LOCAL_DB_FILE);
    let legacy_path = data_dir.join(LEGACY_DB_FILE);
    let should_import = !local_path.exists() && legacy_path.exists();

    let mut conn = open(&local_path)?;
    if should_import {
        match import_legacy(&legacy_path, &mut conn) {
            Ok(stats) => {
                log::info!(
                    "[local_store] 已匯入舊版資料：{} 個群組、{} 則提醒、{} 條重複規則、顯示設定 {}",
                    stats.groups,
                    stats.reminders,
                    stats.rules,
                    if stats.display_setting { "有" } else { "無" }
                );
                let imported = data_dir.join(LEGACY_IMPORTED_FILE);
                if let Err(e) = std::fs::rename(&legacy_path, &imported) {
                    log::error!("[local_store] 舊版資料已匯入，但無法把 remindme.db 改名：{e}");
                }
            }
            Err(e) => log::error!("[local_store] 匯入舊版資料失敗（不影響啟動）：{e}"),
        }
    }
    Ok(conn)
}

// ── 舊版（sidecar + Prisma SQLite）匯入 ─────────────────────────────────────

#[derive(Debug, Default, PartialEq)]
pub struct ImportStats {
    pub groups: usize,
    pub reminders: usize,
    pub rules: usize,
    pub display_setting: bool,
    pub mascot_images: usize,
}

/// Prisma 在 SQLite 把 DateTime 存成 Unix 毫秒的 INTEGER（實測 Prisma 6.19）。
/// 用 raw SQL 的 DEFAULT CURRENT_TIMESTAMP 建立的列則是 `YYYY-MM-DD HH:MM:SS`（UTC）文字，兩種都接受。
fn legacy_datetime(v: &SqlValue) -> Option<i64> {
    match v {
        SqlValue::Integer(i) => Some(*i),
        SqlValue::Real(f) if f.is_finite() => Some(*f as i64),
        SqlValue::Text(s) => {
            let s = s.trim();
            if let Ok(i) = s.parse::<i64>() {
                return Some(i);
            }
            if let Ok(dt) = DateTime::parse_from_rfc3339(s) {
                return Some(dt.timestamp_millis());
            }
            for fmt in ["%Y-%m-%d %H:%M:%S%.f", "%Y-%m-%dT%H:%M:%S%.f"] {
                if let Ok(dt) = NaiveDateTime::parse_from_str(s, fmt) {
                    return Some(dt.and_utc().timestamp_millis());
                }
            }
            NaiveDate::parse_from_str(s, "%Y-%m-%d")
                .ok()
                .and_then(|d| d.and_hms_opt(0, 0, 0))
                .map(|dt| dt.and_utc().timestamp_millis())
        }
        _ => None,
    }
}

fn legacy_bool(v: &SqlValue, default: bool) -> bool {
    match v {
        SqlValue::Integer(i) => *i != 0,
        SqlValue::Real(f) => *f != 0.0,
        SqlValue::Text(s) => matches!(s.trim(), "1" | "true" | "TRUE"),
        _ => default,
    }
}

fn legacy_int(v: &SqlValue) -> Option<i64> {
    match v {
        SqlValue::Integer(i) => Some(*i),
        SqlValue::Real(f) if f.is_finite() => Some(*f as i64),
        SqlValue::Text(s) => s.trim().parse().ok(),
        _ => None,
    }
}

fn legacy_text(v: &SqlValue) -> Option<String> {
    match v {
        SqlValue::Text(s) => Some(s.clone()),
        SqlValue::Integer(i) => Some(i.to_string()),
        SqlValue::Real(f) => Some(f.to_string()),
        _ => None,
    }
}

/// 舊版 weekDays 是 JSON 字串（例如 `"[1,3]"`）；壞掉的值當成空陣列。
pub fn parse_week_days(raw: &str) -> Vec<i64> {
    serde_json::from_str::<Vec<serde_json::Value>>(raw)
        .map(|vals| {
            vals.iter()
                .filter_map(|v| v.as_f64())
                .filter(|f| f.fract() == 0.0)
                .map(|f| f as i64)
                .collect()
        })
        .unwrap_or_default()
}

/// 把一張舊表整張讀成「欄位名 → 值」；表不存在時回傳空陣列。
fn read_legacy_table(
    legacy: &Connection,
    table: &str,
) -> rusqlite::Result<Vec<HashMap<String, SqlValue>>> {
    let exists: bool = legacy
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1",
            [table],
            |_| Ok(true),
        )
        .optional()?
        .unwrap_or(false);
    if !exists {
        return Ok(Vec::new());
    }
    let mut stmt = legacy.prepare(&format!("SELECT * FROM \"{table}\" ORDER BY rowid"))?;
    let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let rows = stmt.query_map([], |row| {
        let mut map = HashMap::new();
        for (i, name) in names.iter().enumerate() {
            map.insert(name.clone(), row.get::<_, SqlValue>(i)?);
        }
        Ok(map)
    })?;
    rows.collect()
}

fn col<'a>(row: &'a HashMap<String, SqlValue>, name: &str) -> &'a SqlValue {
    static NULL: SqlValue = SqlValue::Null;
    row.get(name).unwrap_or(&NULL)
}

pub fn import_legacy(legacy_path: &Path, target: &mut Connection) -> Result<ImportStats, String> {
    // 唯讀開啟，不動到舊檔；函式結束時連線關閉，Windows 上才能改名
    let legacy = Connection::open_with_flags(
        legacy_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| format!("無法開啟舊版資料庫：{e}"))?;

    let groups = read_legacy_table(&legacy, "Group").map_err(|e| e.to_string())?;
    let reminders = read_legacy_table(&legacy, "Reminder").map_err(|e| e.to_string())?;
    let rules = read_legacy_table(&legacy, "RecurrenceRule").map_err(|e| e.to_string())?;
    let displays = read_legacy_table(&legacy, "DisplaySetting").map_err(|e| e.to_string())?;
    let mascots = read_legacy_table(&legacy, "MascotImage").map_err(|e| e.to_string())?;
    drop(legacy);

    let now = now_ms();
    let mut stats = ImportStats::default();
    let tx = target.transaction().map_err(|e| e.to_string())?;

    let mut group_ids = std::collections::HashSet::new();
    for g in &groups {
        let (Some(id), Some(name)) = (legacy_text(col(g, "id")), legacy_text(col(g, "name"))) else {
            continue;
        };
        let created = legacy_datetime(col(g, "createdAt")).unwrap_or(now);
        tx.execute(
            r#"INSERT INTO "Group" ("id", "name", "createdAt") VALUES (?1, ?2, ?3)"#,
            params![id, name, created],
        )
        .map_err(|e| format!("匯入群組失敗：{e}"))?;
        group_ids.insert(id);
        stats.groups += 1;
    }

    let mut reminder_ids = std::collections::HashSet::new();
    for r in &reminders {
        let (Some(id), Some(title)) = (legacy_text(col(r, "id")), legacy_text(col(r, "title"))) else {
            continue;
        };
        // 舊版 Prisma 把 groupId 對應到 group_id 欄位
        let group_id = legacy_text(col(r, "group_id"))
            .or_else(|| legacy_text(col(r, "groupId")))
            .filter(|g| group_ids.contains(g));
        let created = legacy_datetime(col(r, "createdAt")).unwrap_or(now);
        let updated = legacy_datetime(col(r, "updatedAt")).unwrap_or(created);
        tx.execute(
            r#"INSERT INTO "Reminder" (
                "id", "title", "content", "enabled", "scheduleType", "oneTimeAt",
                "autoCloseEnabled", "autoCloseSeconds", "snoozeDefaultSeconds", "sortOrder",
                "endAt", "maxOccurrences", "fireCount", "groupId", "createdAt", "updatedAt"
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)"#,
            params![
                id,
                title,
                legacy_text(col(r, "content")).unwrap_or_default(),
                legacy_bool(col(r, "enabled"), true),
                legacy_text(col(r, "scheduleType")).unwrap_or_else(|| "one_time".to_string()),
                legacy_datetime(col(r, "oneTimeAt")),
                legacy_bool(col(r, "autoCloseEnabled"), false),
                legacy_int(col(r, "autoCloseSeconds")).unwrap_or(60),
                legacy_int(col(r, "snoozeDefaultSeconds")).unwrap_or(300),
                legacy_int(col(r, "sortOrder")).unwrap_or(0),
                legacy_datetime(col(r, "endAt")),
                legacy_int(col(r, "maxOccurrences")),
                // 很舊的資料庫沒有 fireCount 欄位（後來才用 ALTER TABLE 補上）
                legacy_int(col(r, "fireCount")).unwrap_or(0),
                group_id,
                created,
                updated,
            ],
        )
        .map_err(|e| format!("匯入提醒失敗：{e}"))?;
        reminder_ids.insert(id);
        stats.reminders += 1;
    }

    for rule in &rules {
        let (Some(id), Some(mode), Some(reminder_id)) = (
            legacy_text(col(rule, "id")),
            legacy_text(col(rule, "ruleMode")),
            legacy_text(col(rule, "reminderId")),
        ) else {
            continue;
        };
        if !reminder_ids.contains(&reminder_id) {
            continue;
        }
        let week_days = legacy_text(col(rule, "weekDays"))
            .map(|s| parse_week_days(&s))
            .unwrap_or_default();
        tx.execute(
            r#"INSERT INTO "RecurrenceRule" (
                "id", "ruleMode", "monthDay", "weekDays", "timeOfDay", "intervalMinutes",
                "activeFrom", "activeUntil", "reminderId"
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)"#,
            params![
                id,
                mode,
                legacy_int(col(rule, "monthDay")),
                serde_json::to_string(&week_days).unwrap_or_else(|_| "[]".into()),
                legacy_text(col(rule, "timeOfDay")),
                legacy_int(col(rule, "intervalMinutes")),
                legacy_text(col(rule, "activeFrom")),
                legacy_text(col(rule, "activeUntil")),
                reminder_id,
            ],
        )
        .map_err(|e| format!("匯入重複規則失敗：{e}"))?;
        stats.rules += 1;
    }

    // 舊版只有一份顯示設定（沒有帳號）；萬一有多列就取第一列
    if let Some(d) = displays.first() {
        if let Some(id) = legacy_text(col(d, "id")) {
            tx.execute(
                r#"INSERT INTO "DisplaySetting" (
                    "id", "size", "theme", "corner", "showContent", "targetScreenId",
                    "mascotMode", "mascotIcon"
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"#,
                params![
                    id,
                    legacy_text(col(d, "size")).unwrap_or_else(|| "medium".into()),
                    legacy_text(col(d, "theme")).unwrap_or_else(|| "light".into()),
                    legacy_text(col(d, "corner")).unwrap_or_else(|| "bottom_right".into()),
                    legacy_bool(col(d, "showContent"), true),
                    legacy_text(col(d, "targetScreenId")),
                    legacy_text(col(d, "mascotMode")).unwrap_or_else(|| "system".into()),
                    legacy_text(col(d, "mascotIcon")).unwrap_or_else(|| "bell_ring".into()),
                ],
            )
            .map_err(|e| format!("匯入顯示設定失敗：{e}"))?;
            stats.display_setting = true;

            for m in mascots.iter().filter(|m| legacy_text(col(m, "displaySettingId")).as_deref() == Some(id.as_str())) {
                let Some(mid) = legacy_text(col(m, "id")) else { continue };
                tx.execute(
                    r#"INSERT INTO "MascotImage" (
                        "id", "filePath", "mimeType", "width", "height", "sizeBytes", "displaySettingId"
                    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"#,
                    params![
                        mid,
                        legacy_text(col(m, "filePath")).unwrap_or_default(),
                        legacy_text(col(m, "mimeType")).unwrap_or_default(),
                        legacy_int(col(m, "width")).unwrap_or(0),
                        legacy_int(col(m, "height")).unwrap_or(0),
                        legacy_int(col(m, "sizeBytes")).unwrap_or(0),
                        id,
                    ],
                )
                .map_err(|e| format!("匯入吉祥物圖片失敗：{e}"))?;
                stats.mascot_images += 1;
            }
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(stats)
}

// ── 讀取模型 ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct GroupRow {
    pub id: String,
    pub name: String,
    pub created_at: i64,
}

#[derive(Debug, Clone)]
pub struct RuleRow {
    pub id: String,
    pub rule_mode: String,
    pub month_day: Option<i64>,
    pub week_days: Vec<i64>,
    pub time_of_day: Option<String>,
    pub interval_minutes: Option<i64>,
    pub active_from: Option<String>,
    pub active_until: Option<String>,
    pub reminder_id: String,
}

#[derive(Debug, Clone)]
pub struct ReminderRow {
    pub id: String,
    pub title: String,
    pub content: String,
    pub enabled: bool,
    pub schedule_type: String,
    pub one_time_at: Option<i64>,
    pub auto_close_enabled: bool,
    pub auto_close_seconds: i64,
    pub snooze_default_seconds: i64,
    pub sort_order: i64,
    pub end_at: Option<i64>,
    pub max_occurrences: Option<i64>,
    pub fire_count: i64,
    pub group_id: Option<String>,
    pub snooze_until: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
    pub rules: Vec<RuleRow>,
    pub group: Option<GroupRow>,
}

#[derive(Debug, Clone)]
pub struct DisplayRow {
    pub id: String,
    pub size: String,
    pub theme: String,
    pub corner: String,
    pub show_content: bool,
    pub target_screen_id: Option<String>,
    pub mascot_mode: String,
    pub mascot_icon: String,
}

const REMINDER_COLUMNS: &str = r#"r."id", r."title", r."content", r."enabled", r."scheduleType",
    r."oneTimeAt", r."autoCloseEnabled", r."autoCloseSeconds", r."snoozeDefaultSeconds",
    r."sortOrder", r."endAt", r."maxOccurrences", r."fireCount", r."groupId", r."snoozeUntil",
    r."createdAt", r."updatedAt""#;

fn reminder_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ReminderRow> {
    Ok(ReminderRow {
        id: row.get(0)?,
        title: row.get(1)?,
        content: row.get(2)?,
        enabled: row.get(3)?,
        schedule_type: row.get(4)?,
        one_time_at: row.get(5)?,
        auto_close_enabled: row.get(6)?,
        auto_close_seconds: row.get(7)?,
        snooze_default_seconds: row.get(8)?,
        sort_order: row.get(9)?,
        end_at: row.get(10)?,
        max_occurrences: row.get(11)?,
        fire_count: row.get(12)?,
        group_id: row.get(13)?,
        snooze_until: row.get(14)?,
        created_at: row.get(15)?,
        updated_at: row.get(16)?,
        rules: Vec::new(),
        group: None,
    })
}

pub enum ReminderFilter<'a> {
    All,
    Id(&'a str),
    Enabled,
}

/// 讀取提醒並帶上 recurrenceRules 與 group（等同後端的 REMINDER_INCLUDE）。
/// 排序跟後端 findAll 一樣：sortOrder、createdAt，最後用 rowid 讓結果穩定。
pub fn load_reminders(conn: &Connection, filter: ReminderFilter<'_>) -> rusqlite::Result<Vec<ReminderRow>> {
    let (where_sql, arg): (&str, Option<&str>) = match filter {
        ReminderFilter::All => ("", None),
        ReminderFilter::Id(id) => (r#"WHERE r."id" = ?1"#, Some(id)),
        ReminderFilter::Enabled => (r#"WHERE r."enabled" = 1"#, None),
    };
    let sql = format!(
        r#"SELECT {REMINDER_COLUMNS} FROM "Reminder" r {where_sql}
           ORDER BY r."sortOrder" ASC, r."createdAt" ASC, r.rowid ASC"#
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut reminders: Vec<ReminderRow> = match arg {
        Some(a) => stmt.query_map([a], reminder_from_row)?.collect::<Result<_, _>>()?,
        None => stmt.query_map([], reminder_from_row)?.collect::<Result<_, _>>()?,
    };
    if reminders.is_empty() {
        return Ok(reminders);
    }

    let mut rules_by_reminder: HashMap<String, Vec<RuleRow>> = HashMap::new();
    let mut stmt = conn.prepare(
        r#"SELECT "id", "ruleMode", "monthDay", "weekDays", "timeOfDay", "intervalMinutes",
                  "activeFrom", "activeUntil", "reminderId"
           FROM "RecurrenceRule" ORDER BY rowid ASC"#,
    )?;
    let rules = stmt.query_map([], |row| {
        let week_days: String = row.get(3)?;
        Ok(RuleRow {
            id: row.get(0)?,
            rule_mode: row.get(1)?,
            month_day: row.get(2)?,
            week_days: parse_week_days(&week_days),
            time_of_day: row.get(4)?,
            interval_minutes: row.get(5)?,
            active_from: row.get(6)?,
            active_until: row.get(7)?,
            reminder_id: row.get(8)?,
        })
    })?;
    for rule in rules {
        let rule = rule?;
        rules_by_reminder.entry(rule.reminder_id.clone()).or_default().push(rule);
    }

    let groups: HashMap<String, GroupRow> = load_groups(conn)?
        .into_iter()
        .map(|g| (g.id.clone(), g))
        .collect();

    for r in &mut reminders {
        r.rules = rules_by_reminder.remove(&r.id).unwrap_or_default();
        r.group = r.group_id.as_ref().and_then(|g| groups.get(g).cloned());
    }
    Ok(reminders)
}

pub fn load_reminder(conn: &Connection, id: &str) -> rusqlite::Result<Option<ReminderRow>> {
    Ok(load_reminders(conn, ReminderFilter::Id(id))?.into_iter().next())
}

pub fn load_groups(conn: &Connection) -> rusqlite::Result<Vec<GroupRow>> {
    let mut stmt = conn.prepare(
        r#"SELECT "id", "name", "createdAt" FROM "Group" ORDER BY "createdAt" ASC, rowid ASC"#,
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(GroupRow {
            id: row.get(0)?,
            name: row.get(1)?,
            created_at: row.get(2)?,
        })
    })?;
    rows.collect()
}

/// 讀取顯示設定；沒有就回傳 None（排程器用預設值，不自動建立）。
pub fn load_display(conn: &Connection) -> rusqlite::Result<Option<DisplayRow>> {
    conn.query_row(
        r#"SELECT "id", "size", "theme", "corner", "showContent", "targetScreenId",
                  "mascotMode", "mascotIcon"
           FROM "DisplaySetting" ORDER BY rowid ASC LIMIT 1"#,
        [],
        |row| {
            Ok(DisplayRow {
                id: row.get(0)?,
                size: row.get(1)?,
                theme: row.get(2)?,
                corner: row.get(3)?,
                show_content: row.get(4)?,
                target_screen_id: row.get(5)?,
                mascot_mode: row.get(6)?,
                mascot_icon: row.get(7)?,
            })
        },
    )
    .optional()
}

pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// 舊版 sidecar 的 PrismaService.ensureSchema()（ebee72d0 之前）建立的 schema。
    /// `with_fire_count = false` 模擬 fireCount 欄位出現之前的舊資料庫。
    pub fn create_legacy_db(path: &Path, with_fire_count: bool) -> Connection {
        let conn = Connection::open(path).unwrap();
        let fire_count = if with_fire_count {
            r#""fireCount" INTEGER NOT NULL DEFAULT 0,"#
        } else {
            ""
        };
        conn.execute_batch(&format!(
            r#"
            CREATE TABLE "Group" (
                "id" TEXT NOT NULL PRIMARY KEY,
                "name" TEXT NOT NULL,
                "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE UNIQUE INDEX "Group_name_key" ON "Group"("name");
            CREATE TABLE "Reminder" (
                "id" TEXT NOT NULL PRIMARY KEY,
                "title" TEXT NOT NULL,
                "content" TEXT NOT NULL DEFAULT '',
                "enabled" BOOLEAN NOT NULL DEFAULT true,
                "scheduleType" TEXT NOT NULL DEFAULT 'one_time',
                "oneTimeAt" DATETIME,
                "autoCloseEnabled" BOOLEAN NOT NULL DEFAULT false,
                "autoCloseSeconds" INTEGER NOT NULL DEFAULT 60,
                "snoozeDefaultSeconds" INTEGER NOT NULL DEFAULT 300,
                "sortOrder" INTEGER NOT NULL DEFAULT 0,
                "endAt" DATETIME,
                "maxOccurrences" INTEGER,
                {fire_count}
                "group_id" TEXT,
                "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updatedAt" DATETIME NOT NULL,
                CONSTRAINT "Reminder_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "Group" ("id") ON DELETE SET NULL ON UPDATE CASCADE
            );
            CREATE INDEX "Reminder_group_id_idx" ON "Reminder"("group_id");
            CREATE TABLE "RecurrenceRule" (
                "id" TEXT NOT NULL PRIMARY KEY,
                "ruleMode" TEXT NOT NULL,
                "monthDay" INTEGER,
                "weekDays" TEXT NOT NULL DEFAULT '[]',
                "timeOfDay" TEXT,
                "intervalMinutes" INTEGER,
                "activeFrom" TEXT,
                "activeUntil" TEXT,
                "reminderId" TEXT NOT NULL,
                CONSTRAINT "RecurrenceRule_reminderId_fkey" FOREIGN KEY ("reminderId") REFERENCES "Reminder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
            );
            CREATE TABLE "DisplaySetting" (
                "id" TEXT NOT NULL PRIMARY KEY,
                "size" TEXT NOT NULL DEFAULT 'medium',
                "theme" TEXT NOT NULL DEFAULT 'light',
                "corner" TEXT NOT NULL DEFAULT 'bottom_right',
                "showContent" BOOLEAN NOT NULL DEFAULT true,
                "targetScreenId" TEXT,
                "mascotMode" TEXT NOT NULL DEFAULT 'system',
                "mascotIcon" TEXT NOT NULL DEFAULT 'bell_ring'
            );
            CREATE TABLE "MascotImage" (
                "id" TEXT NOT NULL PRIMARY KEY,
                "filePath" TEXT NOT NULL,
                "mimeType" TEXT NOT NULL,
                "width" INTEGER NOT NULL,
                "height" INTEGER NOT NULL,
                "sizeBytes" INTEGER NOT NULL,
                "displaySettingId" TEXT NOT NULL,
                CONSTRAINT "MascotImage_displaySettingId_fkey" FOREIGN KEY ("displaySettingId") REFERENCES "DisplaySetting" ("id") ON DELETE CASCADE ON UPDATE CASCADE
            );
            "#
        ))
        .unwrap();
        conn
    }

    /// 寫入跟 Prisma 6.19 實測相同格式的資料：DateTime 是 Unix 毫秒 INTEGER、
    /// Boolean 是 0/1、enum 是文字、weekDays 是 JSON 字串。
    pub fn seed_legacy_prisma_rows(conn: &Connection) {
        conn.execute_batch(
            r#"
            INSERT INTO "Group" VALUES ('g1', '工作', 1795088799222);
            INSERT INTO "Reminder" ("id","title","content","enabled","scheduleType","oneTimeAt",
                "autoCloseEnabled","autoCloseSeconds","snoozeDefaultSeconds","sortOrder","endAt",
                "maxOccurrences","fireCount","group_id","createdAt","updatedAt")
            VALUES ('r1','單次','c',1,'one_time',1779242400123,1,30,120,0,NULL,NULL,0,'g1',1795088799226,1795088799226),
                   ('r2','每週','',0,'recurring',NULL,0,60,300,1,1798732740000,5,2,NULL,1795088799227,1795088799300);
            INSERT INTO "RecurrenceRule" VALUES ('rule1','weekly_day',NULL,'[1,3]','09:00',NULL,NULL,NULL,'r2');
            INSERT INTO "DisplaySetting" VALUES ('d1','large','dark','top_left',0,'Monitor #1','system','sparkles');
            "#,
        )
        .unwrap();
    }

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("remindme-test-{name}-{}", new_id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn migration_sets_user_version_and_is_idempotent() {
        let mut conn = open_in_memory().unwrap();
        let v: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0)).unwrap();
        assert_eq!(v, MIGRATIONS.len() as i64);
        migrate(&mut conn).unwrap();
        let fk: i64 = conn.pragma_query_value(None, "foreign_keys", |r| r.get(0)).unwrap();
        assert_eq!(fk, 1);
    }

    #[test]
    fn to_iso_matches_js_to_iso_string() {
        assert_eq!(to_iso(1779242400123), "2026-05-20T02:00:00.123Z");
        assert_eq!(to_iso(0), "1970-01-01T00:00:00.000Z");
    }

    #[test]
    fn legacy_datetime_accepts_prisma_integer_and_current_timestamp_text() {
        assert_eq!(legacy_datetime(&SqlValue::Integer(1779242400123)), Some(1779242400123));
        assert_eq!(
            legacy_datetime(&SqlValue::Text("2026-05-20 02:00:00".into())),
            Some(1779242400000)
        );
        assert_eq!(
            legacy_datetime(&SqlValue::Text("2026-05-20T02:00:00.123Z".into())),
            Some(1779242400123)
        );
        assert_eq!(legacy_datetime(&SqlValue::Null), None);
    }

    #[test]
    fn imports_legacy_prisma_database() {
        let dir = temp_dir("import");
        let legacy_path = dir.join(LEGACY_DB_FILE);
        let legacy = create_legacy_db(&legacy_path, true);
        seed_legacy_prisma_rows(&legacy);
        drop(legacy);

        let conn = open_for_app(&dir).unwrap();
        assert!(!legacy_path.exists(), "舊檔應該被改名");
        assert!(dir.join(LEGACY_IMPORTED_FILE).exists());

        let reminders = load_reminders(&conn, ReminderFilter::All).unwrap();
        assert_eq!(reminders.len(), 2);
        let r1 = &reminders[0];
        assert_eq!(r1.id, "r1");
        assert_eq!(r1.one_time_at, Some(1779242400123));
        assert!(r1.enabled);
        assert!(r1.auto_close_enabled);
        assert_eq!(r1.auto_close_seconds, 30);
        assert_eq!(r1.snooze_default_seconds, 120);
        assert_eq!(r1.group.as_ref().map(|g| g.name.as_str()), Some("工作"));
        let r2 = &reminders[1];
        assert!(!r2.enabled);
        assert_eq!(r2.schedule_type, "recurring");
        assert_eq!(r2.end_at, Some(1798732740000));
        assert_eq!(r2.max_occurrences, Some(5));
        assert_eq!(r2.fire_count, 2);
        assert_eq!(r2.rules.len(), 1);
        assert_eq!(r2.rules[0].week_days, vec![1, 3]);
        assert_eq!(r2.rules[0].rule_mode, "weekly_day");
        assert_eq!(r2.rules[0].time_of_day.as_deref(), Some("09:00"));

        let display = load_display(&conn).unwrap().unwrap();
        assert_eq!(display.size, "large");
        assert_eq!(display.theme, "dark");
        assert_eq!(display.corner, "top_left");
        assert!(!display.show_content);
        assert_eq!(display.target_screen_id.as_deref(), Some("Monitor #1"));
        assert_eq!(display.mascot_icon, "sparkles");
        drop(conn);

        // 第二次啟動：local.db 已存在，不會再匯入（舊檔也已改名）
        let conn = open_for_app(&dir).unwrap();
        assert_eq!(load_reminders(&conn, ReminderFilter::All).unwrap().len(), 2);
        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn imports_old_database_without_fire_count_and_with_text_timestamps() {
        let dir = temp_dir("import-old");
        let legacy_path = dir.join(LEGACY_DB_FILE);
        let legacy = create_legacy_db(&legacy_path, false);
        legacy
            .execute_batch(
                r#"
                INSERT INTO "Reminder" ("id","title","scheduleType","oneTimeAt","updatedAt")
                VALUES ('r1','raw','one_time','2026-05-20 02:00:00','2026-05-20 02:00:00');
                INSERT INTO "RecurrenceRule" ("id","ruleMode","weekDays","reminderId")
                VALUES ('bad','interval','not json','r1');
                "#,
            )
            .unwrap();
        drop(legacy);

        let conn = open_for_app(&dir).unwrap();
        let reminders = load_reminders(&conn, ReminderFilter::All).unwrap();
        assert_eq!(reminders.len(), 1);
        assert_eq!(reminders[0].fire_count, 0);
        assert_eq!(reminders[0].one_time_at, Some(1779242400000));
        assert_eq!(reminders[0].rules[0].week_days, Vec::<i64>::new());
        assert!(load_display(&conn).unwrap().is_none());
        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn failed_import_keeps_legacy_file_and_still_opens() {
        let dir = temp_dir("import-bad");
        let legacy_path = dir.join(LEGACY_DB_FILE);
        std::fs::write(&legacy_path, b"this is not a sqlite database").unwrap();

        let conn = open_for_app(&dir).unwrap();
        assert!(legacy_path.exists(), "匯入失敗時不改名");
        assert!(load_reminders(&conn, ReminderFilter::All).unwrap().is_empty());
        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn no_import_when_local_db_already_exists() {
        let dir = temp_dir("import-skip");
        drop(open(&dir.join(LOCAL_DB_FILE)).unwrap());
        let legacy = create_legacy_db(&dir.join(LEGACY_DB_FILE), true);
        seed_legacy_prisma_rows(&legacy);
        drop(legacy);

        let conn = open_for_app(&dir).unwrap();
        assert!(load_reminders(&conn, ReminderFilter::All).unwrap().is_empty());
        assert!(dir.join(LEGACY_DB_FILE).exists());
        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
