'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { GripVertical, PenLine, Plus, Trash2 } from 'lucide-react';
import { DesktopPopupPreview } from '../components/DesktopPopupPreview';
import { DisplayPanel, DisplaySetting } from '../components/DisplayPanel';
import { FormState, TaskForm } from '../components/TaskForm';
import styles from './page.module.css';

type Reminder = {
  id: string;
  title: string;
  content: string;
  enabled: boolean;
  scheduleType: 'one_time' | 'recurring';
  oneTimeAt: string | null;
  sortOrder: number;
  endAt: string | null;
  maxOccurrences: number | null;
  autoCloseEnabled: boolean;
  autoCloseSeconds: number;
  snoozeDefaultSeconds: number;
  recurrenceRules: Array<{
    id: string;
    ruleMode: 'monthly_day' | 'weekly_day' | 'daily_time';
    monthDay: number | null;
    weekDay: number | null;
    timeOfDay: string | null;
  }>;
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';
const DEFAULT_FORM: FormState = {
  title: '',
  content: '',
  scheduleType: 'one_time',
  oneTimeAt: '',
  recurrenceMode: 'daily_time',
  monthDay: 1,
  weekDay: 1,
  dailyTime: '15:00',
  endAt: '',
  maxOccurrences: '',
  autoCloseEnabled: false,
  autoCloseSeconds: 60,
  snoozeDefaultSeconds: 300,
};

export default function Home() {
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' } | null>(
    null,
  );
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [savedDisplaySetting, setSavedDisplaySetting] = useState<DisplaySetting | null>(null);
  const [displaySetting, setDisplaySetting] = useState<DisplaySetting | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<'display' | 'task'>('task');
  const [taskView, setTaskView] = useState<'list' | 'editor'>('list');
  const [selectedGroup, setSelectedGroup] = useState<string>('');
  const [groupNames, setGroupNames] = useState<string[]>([]);
  const [reminderGroupMap, setReminderGroupMap] = useState<Record<string, string>>({});
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [editingGroupName, setEditingGroupName] = useState<string | null>(null);
  const [editingGroupValue, setEditingGroupValue] = useState('');
  const [draggingReminderId, setDraggingReminderId] = useState<string | null>(null);
  const isEditing = Boolean(editingId);
  const statusText = useMemo(() => (loading ? '載入中...' : ''), [loading]);
  const groups = useMemo(() => {
    const grouped = groupNames.map((name) => ({
      name,
      items: reminders.filter((item) => reminderGroupMap[item.id] === name),
    }));
    const ungrouped = reminders.filter((item) => !reminderGroupMap[item.id]);
    if (ungrouped.length > 0) {
      grouped.push({ name: '未分組', items: ungrouped });
    }
    return grouped;
  }, [groupNames, reminders, reminderGroupMap]);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), 2600);
    return () => window.clearTimeout(timer);
  }, [message]);

  async function fetchReminders() {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/reminders`, { cache: 'no-store' });
      if (!response.ok) throw new Error('讀取提醒失敗');
      setReminders((await response.json()) as Reminder[]);
    } catch {
      setMessage({ text: '無法連線後端 API，請先啟動 backend。', tone: 'error' });
    } finally {
      setLoading(false);
    }
  }

  async function fetchDisplaySetting() {
    try {
      const response = await fetch(`${API_BASE_URL}/display-settings/current`, {
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('讀取顯示設定失敗');
      const incoming = (await response.json()) as DisplaySetting;
      setSavedDisplaySetting(incoming);
      setDisplaySetting(incoming);
    } catch {
      setMessage({ text: '讀取顯示設定失敗', tone: 'error' });
    }
  }

  async function loadAll() {
    await Promise.all([fetchReminders(), fetchDisplaySetting()]);
  }

  function buildRecurrenceRule() {
    if (form.recurrenceMode === 'monthly_day') return { ruleMode: 'monthly_day', monthDay: form.monthDay };
    if (form.recurrenceMode === 'weekly_day') return { ruleMode: 'weekly_day', weekDay: form.weekDay };
    return { ruleMode: 'daily_time', timeOfDay: form.dailyTime };
  }

  function buildReminderPayload(skipShortMonthConfirmation: boolean) {
    return form.scheduleType === 'one_time'
      ? {
          title: form.title,
          content: form.content,
          scheduleType: form.scheduleType,
          oneTimeAt: new Date(form.oneTimeAt).toISOString(),
          autoCloseEnabled: form.autoCloseEnabled,
          autoCloseSeconds: form.autoCloseSeconds,
          snoozeDefaultSeconds: form.snoozeDefaultSeconds,
          endAt: form.endAt || undefined,
          maxOccurrences: form.maxOccurrences ? Number(form.maxOccurrences) : undefined,
          skipShortMonthConfirmation,
        }
      : {
          title: form.title,
          content: form.content,
          scheduleType: form.scheduleType,
          recurrenceRules: [buildRecurrenceRule()],
          autoCloseEnabled: form.autoCloseEnabled,
          autoCloseSeconds: form.autoCloseSeconds,
          snoozeDefaultSeconds: form.snoozeDefaultSeconds,
          endAt: form.endAt || undefined,
          maxOccurrences: form.maxOccurrences ? Number(form.maxOccurrences) : undefined,
          skipShortMonthConfirmation,
        };
  }

  async function upsertReminder(skipShortMonthConfirmation = false) {
    const method = isEditing ? 'PATCH' : 'POST';
    const url = isEditing ? `${API_BASE_URL}/reminders/${editingId}` : `${API_BASE_URL}/reminders`;
    return fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildReminderPayload(skipShortMonthConfirmation)),
    });
  }

  function readErrorMessage(data: unknown) {
    if (typeof data === 'object' && data !== null && 'message' in data && typeof (data as { message: unknown }).message === 'string') {
      return (data as { message: string }).message;
    }
    return `${isEditing ? '更新' : '建立'}提醒失敗，請檢查欄位`;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    try {
      let response = await upsertReminder(false);
      let data = await response.json();
      const shortMonthRequired =
        !response.ok &&
        ((data?.message?.code === 'SHORT_MONTH_CONFIRMATION_REQUIRED') ||
          data?.code === 'SHORT_MONTH_CONFIRMATION_REQUIRED');

      if (shortMonthRequired) {
        const confirmed = window.confirm('若遇到沒有該日期的月份，此月份將跳過提醒，是否確定繼續？');
        if (!confirmed) return setMessage({ text: '已取消建立提醒', tone: 'error' });
        response = await upsertReminder(true);
        data = await response.json();
      }

      if (!response.ok) return setMessage({ text: readErrorMessage(data), tone: 'error' });
      setForm(DEFAULT_FORM);
      setEditingId(null);
      setTaskView('list');
      if (!isEditing && selectedGroup) {
        const created = data as Reminder;
        if (created?.id) {
          setReminderGroupMap((prev) => ({ ...prev, [created.id]: selectedGroup }));
        }
      }
      setMessage({ text: `提醒${isEditing ? '更新' : '建立'}成功`, tone: 'success' });
      await fetchReminders();
    } catch {
      setMessage({
        text: `${isEditing ? '更新' : '建立'}提醒失敗，請確認後端狀態。`,
        tone: 'error',
      });
    }
  }

  function formatDateTimeForInput(value: string | null) {
    if (!value) return '';
    const date = new Date(value);
    const offsetMs = date.getTimezoneOffset() * 60 * 1000;
    return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
  }

  function beginEdit(reminder: Reminder) {
    const parentGroup =
      groups.find((group) => group.items.some((item) => item.id === reminder.id))?.name ??
      '未分組';
    setSelectedGroup(parentGroup);
    const firstRule = reminder.recurrenceRules[0];
    setEditingId(reminder.id);
    setTaskView('editor');
    setForm({
      title: reminder.title,
      content: reminder.content,
      scheduleType: reminder.scheduleType,
      oneTimeAt: formatDateTimeForInput(reminder.oneTimeAt),
      recurrenceMode:
        firstRule?.ruleMode === 'monthly_day'
          ? 'monthly_day'
          : firstRule?.ruleMode === 'weekly_day'
            ? 'weekly_day'
            : 'daily_time',
      monthDay: firstRule?.monthDay ?? 1,
      weekDay: firstRule?.weekDay ?? 1,
      dailyTime: firstRule?.timeOfDay ?? '15:00',
      endAt: formatDateTimeForInput(reminder.endAt),
      maxOccurrences: reminder.maxOccurrences ? String(reminder.maxOccurrences) : '',
      autoCloseEnabled: reminder.autoCloseEnabled,
      autoCloseSeconds: reminder.autoCloseSeconds,
      snoozeDefaultSeconds: reminder.snoozeDefaultSeconds,
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(DEFAULT_FORM);
    setTaskView('list');
  }

  async function deleteReminder(id: string) {
    await fetch(`${API_BASE_URL}/reminders/${id}`, { method: 'DELETE' });
    await fetchReminders();
  }

  async function saveDisplaySetting() {
    if (!displaySetting) return;
    const response = await fetch(`${API_BASE_URL}/display-settings/current`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        size: displaySetting.size,
        theme: displaySetting.theme,
        corner: displaySetting.corner,
        showContent: displaySetting.showContent,
        targetScreenId: displaySetting.targetScreenId ?? '',
        mascotMode: displaySetting.mascotMode,
      }),
    });
    if (!response.ok) return setMessage({ text: '顯示設定更新失敗', tone: 'error' });
    const updated = (await response.json()) as DisplaySetting;
    setSavedDisplaySetting(updated);
    setDisplaySetting(updated);
    setMessage({ text: '顯示設定已更新', tone: 'success' });
  }

  function createGroup() {
    const name = newGroupName.trim() || '未命名群組';
    if (groupNames.includes(name)) {
      setMessage({ text: '此群組名已佔用，請使用其他名稱。', tone: 'error' });
      return;
    }
    setGroupNames((prev) => [...prev, name]);
    setSelectedGroup(name);
    setShowCreateGroup(false);
    setNewGroupName('');
    setTaskView('list');
  }

  function deleteGroup(groupName: string) {
    setGroupNames((prev) => prev.filter((name) => name !== groupName));
    setReminderGroupMap((prev) => {
      const next = { ...prev };
      Object.entries(next).forEach(([id, group]) => {
        if (group === groupName) {
          delete next[id];
        }
      });
      return next;
    });
    if (selectedGroup === groupName) {
      setSelectedGroup('');
      setTaskView('list');
      setEditingId(null);
      setForm(DEFAULT_FORM);
    }
  }

  function createReminderInGroup(groupName: string) {
    setSelectedGroup(groupName);
    setEditingId(null);
    setForm(DEFAULT_FORM);
    setTaskView('editor');
  }

  function renameGroup(originalName: string) {
    const nextName = editingGroupValue.trim() || originalName;
    if (nextName !== originalName && groupNames.includes(nextName)) {
      setMessage({ text: '此群組名已佔用，請使用其他名稱。', tone: 'error' });
      return;
    }
    setGroupNames((prev) => prev.map((name) => (name === originalName ? nextName : name)));
    setReminderGroupMap((prev) => {
      const next = { ...prev };
      Object.entries(next).forEach(([id, group]) => {
        if (group === originalName) {
          next[id] = nextName;
        }
      });
      return next;
    });
    if (selectedGroup === originalName) {
      setSelectedGroup(nextName);
    }
    setEditingGroupName(null);
    setEditingGroupValue('');
  }

  async function reorderByDraggedItem(targetId: string) {
    if (!draggingReminderId || draggingReminderId === targetId) return;
    const fromIndex = reminders.findIndex((item) => item.id === draggingReminderId);
    const toIndex = reminders.findIndex((item) => item.id === targetId);
    if (fromIndex < 0 || toIndex < 0) return;
    const reordered = [...reminders];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    setDraggingReminderId(null);
    await fetch(`${API_BASE_URL}/reminders/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: reordered.map((reminder, sortOrder) => ({ id: reminder.id, sortOrder })),
      }),
    });
    await fetchReminders();
  }

  return (
    <main className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>提醒管理工具</h1>
          {statusText ? <p className={styles.status}>{statusText}</p> : null}
        </div>
        <button onClick={() => void loadAll()} className={styles.toolbarButton}>
          載入資料
        </button>
      </div>
      {message ? (
        <p
          className={`${styles.message} ${
            message.tone === 'success' ? styles.messageSuccess : styles.messageError
          }`}
        >
          {message.text}
        </p>
      ) : null}

      <section className={styles.layout}>
        <aside className={styles.leftCol}>
          <div className={styles.toolList}>
            <button
              className={`${styles.toolButton} ${
                activeTool === 'display' ? styles.toolButtonActive : ''
              }`}
              onClick={() => {
                setActiveTool('display');
                setDisplaySetting(savedDisplaySetting);
              }}
            >
              <span className={styles.toolButtonIcon} />
              顯示工具
            </button>
            <button
              className={`${styles.toolButton} ${
                activeTool === 'task' ? styles.toolButtonActive : ''
              }`}
              onClick={() => {
                setActiveTool('task');
                setTaskView('list');
                setDisplaySetting(savedDisplaySetting);
              }}
            >
              <span className={styles.toolButtonIcon} />
              任務工具
            </button>
          </div>
        </aside>
        <section className={styles.rightCol}>
          {activeTool === 'display' ? (
            <DisplayPanel
              displaySetting={displaySetting}
              onChange={setDisplaySetting}
              onSave={() => void saveDisplaySetting()}
            />
          ) : (
            <div className={styles.glass}>
              {taskView === 'list' ? (
                <div className={styles.groupList}>
                  <div className={styles.groupItem}>
                    <button
                      className={styles.fullWidthButton}
                      onClick={() => {
                        setShowCreateGroup((prev) => !prev);
                        setNewGroupName('');
                      }}
                    >
                      <Plus size={14} /> 新增任務群組
                    </button>
                    {showCreateGroup ? (
                      <div className={styles.groupChildren}>
                        <input
                          value={newGroupName}
                          onChange={(event) => setNewGroupName(event.target.value)}
                          className={styles.groupInput}
                          placeholder="未命名群組"
                          onFocus={() => {
                            if (newGroupName === '未命名群組') {
                              setNewGroupName('');
                            }
                          }}
                        />
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button
                            className={styles.childButton}
                            onClick={() => {
                              setShowCreateGroup(false);
                            }}
                          >
                            取消
                          </button>
                          <button
                            className={styles.childButton}
                            onClick={createGroup}
                          >
                            建立
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                  {groups.map((group) => (
                    <div className={styles.groupItem} key={group.name}>
                      <div className={styles.groupHeader}>
                        {editingGroupName === group.name ? (
                          <input
                            className={styles.groupInput}
                            value={editingGroupValue}
                            onChange={(event) => setEditingGroupValue(event.target.value)}
                          />
                        ) : (
                          <span>{group.name}</span>
                        )}
                        {group.name !== '未分組' ? (
                          <div className={styles.headerActions}>
                            {editingGroupName === group.name ? (
                              <>
                                <button
                                  className={styles.iconButton}
                                  onClick={() => {
                                    setEditingGroupName(null);
                                    setEditingGroupValue('');
                                  }}
                                >
                                  取消
                                </button>
                                <button
                                  className={styles.iconButton}
                                  onClick={() => renameGroup(group.name)}
                                >
                                  儲存
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  className={styles.iconButton}
                                  onClick={() => {
                                    setEditingGroupName(group.name);
                                    setEditingGroupValue(group.name);
                                  }}
                                  title="編輯群組名稱"
                                >
                                  <PenLine size={14} />
                                </button>
                                <button
                                  className={styles.iconButton}
                                  onClick={() => deleteGroup(group.name)}
                                  title="刪除群組"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </>
                            )}
                          </div>
                        ) : null}
                      </div>
                      <div className={styles.groupChildren}>
                        <div className={styles.childRow}>
                          <button
                            className={styles.childButton}
                            onClick={() => createReminderInGroup(group.name)}
                          >
                            <Plus size={14} /> 新增提醒
                          </button>
                        </div>
                        {group.items.length === 0 ? (
                          <div className={styles.childRow}>此群組目前無提醒項目</div>
                        ) : (
                          group.items.map((item) => (
                            <div
                              className={styles.childRow}
                              key={item.id}
                              draggable
                              onDragStart={() => setDraggingReminderId(item.id)}
                              onDragOver={(event) => event.preventDefault()}
                              onDrop={() => void reorderByDraggedItem(item.id)}
                            >
                              <span className={styles.reminderName}>{item.title}</span>
                              <div className={styles.headerActions}>
                                <button
                                  className={`${styles.iconButton} ${styles.dragHandle}`}
                                  title="拖曳調整優先順序"
                                >
                                  <GripVertical size={14} />
                                </button>
                                <button
                                  className={styles.iconButton}
                                  onClick={() => {
                                    setSelectedGroup(group.name);
                                    beginEdit(item);
                                  }}
                                  title="編輯提醒"
                                >
                                  <PenLine size={14} />
                                </button>
                                <button
                                  className={styles.iconButton}
                                  onClick={() => void deleteReminder(item.id)}
                                  title="刪除提醒"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  <p className={styles.breadcrumb}>
                    <button
                      className={styles.breadcrumbLink}
                      onClick={() => {
                        setTaskView('list');
                        setEditingId(null);
                      }}
                    >
                      任務工具
                    </button>
                    {' > '}
                    <button
                      className={styles.breadcrumbLink}
                      onClick={() => {
                        setTaskView('list');
                      }}
                    >
                      {selectedGroup || '未分組'}
                    </button>
                    {' > '}
                    <span>{form.title || '提醒編輯'}</span>
                  </p>
                  <TaskForm
                    form={form}
                    isEditing={isEditing}
                    onSubmit={handleSubmit}
                    onCancelEdit={cancelEdit}
                    onChange={setForm}
                  />
                </>
              )}
            </div>
          )}
        </section>
      </section>

      <DesktopPopupPreview
        displaySetting={displaySetting}
        form={form}
        visible={activeTool === 'display'}
      />
    </main>
  );
}
