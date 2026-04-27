'use client';

import { FormEvent } from 'react';
import styles from './TaskForm.module.css';

type RecurrenceMode = 'monthly_day' | 'weekly_day' | 'daily_time';
type ScheduleType = 'one_time' | 'recurring';

export type FormState = {
  title: string;
  content: string;
  scheduleType: ScheduleType;
  oneTimeAt: string;
  recurrenceMode: RecurrenceMode;
  monthDay: number;
  weekDay: number;
  dailyTime: string;
  endAt: string;
  maxOccurrences: string;
  autoCloseEnabled: boolean;
  autoCloseSeconds: number;
  snoozeDefaultSeconds: number;
};

type Props = {
  form: FormState;
  isEditing: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancelEdit: () => void;
  onChange: (next: FormState) => void;
};

export function TaskForm({ form, isEditing, onSubmit, onCancelEdit, onChange }: Props) {
  return (
    <section className={styles.card}>
      <h2 className={styles.title}>任務工具：{isEditing ? '編輯提醒' : '新增提醒'}</h2>
      <form onSubmit={onSubmit} className={styles.form}>
        <input
          placeholder="標題"
          value={form.title}
          onChange={(event) => onChange({ ...form, title: event.target.value })}
          required
        />
        <textarea
          placeholder="內容"
          value={form.content}
          onChange={(event) => onChange({ ...form, content: event.target.value })}
          rows={3}
        />

        <label>
          排程類型
          <select
            value={form.scheduleType}
            onChange={(event) =>
              onChange({ ...form, scheduleType: event.target.value as ScheduleType })
            }
            style={{ marginTop: 4 }}
          >
            <option value="one_time">單次時間</option>
            <option value="recurring">重複規則</option>
          </select>
        </label>

        {form.scheduleType === 'one_time' ? (
          <input
            type="datetime-local"
            value={form.oneTimeAt}
            onChange={(event) => onChange({ ...form, oneTimeAt: event.target.value })}
            required
          />
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            <label>
              規則模式
              <select
                value={form.recurrenceMode}
                onChange={(event) =>
                  onChange({ ...form, recurrenceMode: event.target.value as RecurrenceMode })
                }
                style={{ marginTop: 4 }}
              >
                <option value="monthly_day">每月幾號</option>
                <option value="weekly_day">每週週幾</option>
                <option value="daily_time">每日幾時幾分</option>
              </select>
            </label>
            {form.recurrenceMode === 'monthly_day' ? (
              <input
                type="number"
                min={1}
                max={31}
                value={form.monthDay}
                onChange={(event) => onChange({ ...form, monthDay: Number(event.target.value) })}
              />
            ) : null}
            {form.recurrenceMode === 'weekly_day' ? (
              <select
                value={form.weekDay}
                onChange={(event) => onChange({ ...form, weekDay: Number(event.target.value) })}
              >
                <option value={0}>週日</option>
                <option value={1}>週一</option>
                <option value={2}>週二</option>
                <option value={3}>週三</option>
                <option value={4}>週四</option>
                <option value={5}>週五</option>
                <option value={6}>週六</option>
              </select>
            ) : null}
            {form.recurrenceMode === 'daily_time' ? (
              <input
                type="time"
                value={form.dailyTime}
                onChange={(event) => onChange({ ...form, dailyTime: event.target.value })}
              />
            ) : null}
          </div>
        )}

        <label>
          結束日期（可選）
          <input
            type="datetime-local"
            value={form.endAt}
            onChange={(event) => onChange({ ...form, endAt: event.target.value })}
            style={{ marginTop: 4 }}
          />
        </label>

        <label>
          最大提醒次數（可選）
          <input
            type="number"
            min={1}
            value={form.maxOccurrences}
            onChange={(event) => onChange({ ...form, maxOccurrences: event.target.value })}
            style={{ marginTop: 4 }}
          />
        </label>

        <label>
          <input
            type="checkbox"
            checked={form.autoCloseEnabled}
            onChange={(event) => onChange({ ...form, autoCloseEnabled: event.target.checked })}
          />{' '}
          自動關閉
        </label>
        <label>
          自動關閉秒數
          <input
            type="number"
            min={1}
            max={600}
            value={form.autoCloseSeconds}
            onChange={(event) =>
              onChange({ ...form, autoCloseSeconds: Number(event.target.value) })
            }
            style={{ marginTop: 4 }}
          />
        </label>
        <label>
          稍後提醒秒數（60~600）
          <input
            type="number"
            min={60}
            max={600}
            value={form.snoozeDefaultSeconds}
            onChange={(event) =>
              onChange({ ...form, snoozeDefaultSeconds: Number(event.target.value) })
            }
            style={{ display: 'block', marginTop: 4 }}
          />
        </label>

        <div className={styles.row}>
          <button type="submit" className={styles.primary}>
            {isEditing ? '更新提醒' : '建立提醒'}
          </button>
          {isEditing ? (
            <button onClick={onCancelEdit} className={styles.ghost}>
              取消編輯
            </button>
          ) : null}
        </div>
      </form>
    </section>
  );
}
