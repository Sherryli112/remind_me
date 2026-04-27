'use client';
import styles from './ReminderList.module.css';

type Reminder = {
  id: string;
  title: string;
  content: string;
  enabled: boolean;
  scheduleType: 'one_time' | 'recurring';
  oneTimeAt: string | null;
  recurrenceRules: Array<{
    id: string;
    ruleMode: 'monthly_day' | 'weekly_day' | 'daily_time';
    monthDay: number | null;
    weekDay: number | null;
    timeOfDay: string | null;
  }>;
};

type Props = {
  reminders: Reminder[];
  onToggle: (id: string, enabled: boolean) => void;
  onEdit: (id: string) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onDelete: (id: string) => void;
};

const weekNames = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];

export function ReminderList({ reminders, onToggle, onEdit, onMove, onDelete }: Props) {
  return (
    <section className={styles.card}>
      <h2 className={styles.title}>提醒清單（可調整優先順序）</h2>
      <div className={styles.list}>
        {reminders.map((reminder, index) => (
          <article
            key={reminder.id}
            className={`${styles.item} ${!reminder.enabled ? styles.itemDisabled : ''}`}
          >
            <h3 style={{ margin: 0 }}>{reminder.title}</h3>
            <p style={{ margin: '8px 0' }}>{reminder.content || '（無內容）'}</p>
            <p style={{ margin: '8px 0' }}>
              類型：{reminder.scheduleType === 'one_time' ? '單次' : '重複'}
            </p>
            {reminder.scheduleType === 'one_time' ? (
              <p style={{ margin: '8px 0' }}>時間：{reminder.oneTimeAt ?? '未設定'}</p>
            ) : (
              <p style={{ margin: '8px 0' }}>
                規則：
                {reminder.recurrenceRules
                  .map((rule) => {
                    if (rule.ruleMode === 'monthly_day') {
                      return `每月 ${rule.monthDay} 號`;
                    }
                    if (rule.ruleMode === 'weekly_day') {
                      return `每${weekNames[rule.weekDay ?? 0]}`;
                    }
                    return `每日 ${rule.timeOfDay}`;
                  })
                  .join(' / ')}
              </p>
            )}
            <div className={styles.actions}>
              <button onClick={() => onToggle(reminder.id, reminder.enabled)}>
                {reminder.enabled ? '停用' : '啟用'}
              </button>
              <button onClick={() => onEdit(reminder.id)}>編輯</button>
              <button onClick={() => onMove(index, -1)}>上移</button>
              <button onClick={() => onMove(index, 1)}>下移</button>
              <button onClick={() => onDelete(reminder.id)}>刪除</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
