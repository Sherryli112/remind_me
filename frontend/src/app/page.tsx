'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  ActionIcon,
  Box,
  Button,
  Divider,
  Group,
  NavLink,
  Notification,
  Paper,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Tooltip,
  useComputedColorScheme,
  useMantineColorScheme,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  DropAnimation,
  MeasuringStrategy,
  PointerSensor,
  closestCenter,
  defaultDropAnimationSideEffects,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import {
  ArrowLeft,
  BellPlus,
  BellRing,
  ListTodo,
  Monitor,
  Moon,
  PanelLeftClose,
  PenLine,
  Plus,
  RotateCcw,
  Sun,
  Trash2,
} from 'lucide-react';
import { DisplayPanel, DisplaySetting } from '../components/DisplayPanel';
import { ReminderRowOverlay, SortableReminderRow } from '../components/SortableReminderRow';
import { FormState, TaskForm } from '../components/TaskForm';

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
    ruleMode: 'interval' | 'daily_time' | 'weekly_day' | 'monthly_day';
    monthDay: number | null;
    weekDays: number[];
    timeOfDay: string | null;
    intervalMinutes: number | null;
    activeFrom: string | null;
    activeUntil: string | null;
  }>;
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';
const STORAGE_KEY_GROUP_NAMES = 'remindme:groupNames';
const STORAGE_KEY_GROUP_MAP = 'remindme:reminderGroupMap';
const SESSION_KEY_FORM_DRAFT = 'remindme:form-draft';

// 直接呼叫 getBoundingClientRect，繞過 dnd-kit 預設 measure 在我們 layout 下會偏移的問題
function getRectFromNode(node: HTMLElement) {
  const r = node.getBoundingClientRect();
  return {
    top: r.top,
    left: r.left,
    width: r.width,
    height: r.height,
    right: r.right,
    bottom: r.bottom,
  };
}

const DEFAULT_FORM: FormState = {
  title: '',
  content: '',
  scheduleType: 'one_time',
  oneTimeAt: '',
  recurrenceMode: 'daily_time',
  dailyTime: '15:00',
  weeklyWeekDays: [1],
  weeklyTime: '15:00',
  monthlyMonthDay: 1,
  monthlyTime: '09:00',
  intervalMinutes: 30,
  intervalUseWindow: false,
  intervalActiveFrom: '09:00',
  intervalActiveUntil: '18:00',
  intervalUseWeekdays: false,
  intervalWeekDays: [1, 2, 3, 4, 5],
  endAt: '',
  maxOccurrences: '',
  autoCloseEnabled: false,
  autoCloseSeconds: 60,
  snoozeDefaultSeconds: 300,
};

export default function Home() {
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error'; onRetry?: () => void } | null>(
    null,
  );
  const { setColorScheme } = useMantineColorScheme();
  const colorScheme = useComputedColorScheme('light');
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [savedDisplaySetting, setSavedDisplaySetting] = useState<DisplaySetting | null>(null);
  const [displaySetting, setDisplaySetting] = useState<DisplaySetting | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<'display' | 'task'>('task');
  const [taskView, setTaskView] = useState<'list' | 'editor'>('list');
  const [selectedGroup, setSelectedGroup] = useState<string>('');
  const [groupNames, setGroupNames] = useState<string[]>([]);
  const [reminderGroupMap, setReminderGroupMap] = useState<Record<string, string>>({});
  const [groupsHydrated, setGroupsHydrated] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [editingGroupName, setEditingGroupName] = useState<string | null>(null);
  const [editingGroupValue, setEditingGroupValue] = useState('');
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('remindme:sidebar-collapsed') === '1';
  });
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );
  // 放下時的歸位動畫：平順 ease-out，避免 overshoot 造成抖動
  const dropAnimation: DropAnimation = {
    duration: 220,
    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    sideEffects: defaultDropAnimationSideEffects({
      styles: { active: { opacity: '0.4' } },
    }),
  };
  const activeReminder = useMemo(
    () => (activeDragId ? reminders.find((item) => item.id === activeDragId) ?? null : null),
    [activeDragId, reminders],
  );
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
    // 成功訊息看完就消，錯誤訊息留久一點 + 提供關閉鈕（見 Notification withCloseButton）
    const duration = message.tone === 'success' ? 2600 : 6000;
    const timer = window.setTimeout(() => setMessage(null), duration);
    return () => window.clearTimeout(timer);
  }, [message]);

  // mount 時自動抓資料，避免使用者開頁後看到空狀態
  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // mount 時若 sessionStorage 有編輯草稿，還原進入編輯頁
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(SESSION_KEY_FORM_DRAFT);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        form?: FormState;
        editingId?: string | null;
        selectedGroup?: string;
      };
      if (parsed?.form) {
        setForm(parsed.form);
        setEditingId(parsed.editingId ?? null);
        setSelectedGroup(parsed.selectedGroup ?? '');
        setActiveTool('task');
        setTaskView('editor');
      }
    } catch {
      // 壞掉的草稿直接忽略
    }
  }, []);

  // 在編輯頁時持續把表單寫進 sessionStorage，離開編輯頁清掉
  useEffect(() => {
    if (taskView !== 'editor') {
      window.sessionStorage.removeItem(SESSION_KEY_FORM_DRAFT);
      return;
    }
    window.sessionStorage.setItem(
      SESSION_KEY_FORM_DRAFT,
      JSON.stringify({ form, editingId, selectedGroup }),
    );
  }, [form, editingId, selectedGroup, taskView]);

  useEffect(() => {
    try {
      const rawNames = window.localStorage.getItem(STORAGE_KEY_GROUP_NAMES);
      const rawMap = window.localStorage.getItem(STORAGE_KEY_GROUP_MAP);
      if (rawNames) {
        const parsed = JSON.parse(rawNames) as unknown;
        if (Array.isArray(parsed) && parsed.every((value) => typeof value === 'string')) {
          setGroupNames(parsed as string[]);
        }
      }
      if (rawMap) {
        const parsed = JSON.parse(rawMap) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const safe: Record<string, string> = {};
          for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
            if (typeof value === 'string') safe[key] = value;
          }
          setReminderGroupMap(safe);
        }
      }
    } catch {
      // 解析失敗時保留預設空狀態，避免擋住整個畫面
    } finally {
      setGroupsHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!groupsHydrated) return;
    window.localStorage.setItem(STORAGE_KEY_GROUP_NAMES, JSON.stringify(groupNames));
  }, [groupNames, groupsHydrated]);

  useEffect(() => {
    if (!groupsHydrated) return;
    window.localStorage.setItem(STORAGE_KEY_GROUP_MAP, JSON.stringify(reminderGroupMap));
  }, [reminderGroupMap, groupsHydrated]);

  async function fetchReminders() {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/reminders`, { cache: 'no-store' });
      if (!response.ok) throw new Error('讀取提醒失敗');
      setReminders((await response.json()) as Reminder[]);
    } catch {
      setMessage({ text: '無法連線後端 API，請先啟動 backend。', tone: 'error', onRetry: () => void loadAll() });
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
    if (form.recurrenceMode === 'monthly_day') {
      return {
        ruleMode: 'monthly_day' as const,
        monthDay: form.monthlyMonthDay,
        timeOfDay: form.monthlyTime,
      };
    }
    if (form.recurrenceMode === 'weekly_day') {
      return {
        ruleMode: 'weekly_day' as const,
        weekDays: form.weeklyWeekDays,
        timeOfDay: form.weeklyTime,
      };
    }
    if (form.recurrenceMode === 'interval') {
      return {
        ruleMode: 'interval' as const,
        intervalMinutes: form.intervalMinutes,
        ...(form.intervalUseWindow
          ? { activeFrom: form.intervalActiveFrom, activeUntil: form.intervalActiveUntil }
          : {}),
        ...(form.intervalUseWeekdays ? { weekDays: form.intervalWeekDays } : {}),
      };
    }
    return { ruleMode: 'daily_time' as const, timeOfDay: form.dailyTime };
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
      // 後端用 409 + { code: 'SHORT_MONTH_CONFIRMATION_REQUIRED' } 表示需要二次確認
      const shortMonthRequired =
        response.status === 409 && data?.code === 'SHORT_MONTH_CONFIRMATION_REQUIRED';

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
      // 「未分組」是 useMemo 自動產生的 bucket，不寫進 map；
      // 否則 grouped 找不到、ungrouped 又因為 map 有值被排除，會讓新提醒消失。
      if (!isEditing && selectedGroup && selectedGroup !== '未分組') {
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
    const ruleMode: FormState['recurrenceMode'] = firstRule
      ? (firstRule.ruleMode as FormState['recurrenceMode'])
      : 'daily_time';
    setForm({
      ...DEFAULT_FORM,
      title: reminder.title,
      content: reminder.content,
      scheduleType: reminder.scheduleType,
      oneTimeAt: formatDateTimeForInput(reminder.oneTimeAt),
      recurrenceMode: ruleMode,
      dailyTime:
        firstRule?.ruleMode === 'daily_time'
          ? firstRule.timeOfDay ?? '15:00'
          : DEFAULT_FORM.dailyTime,
      weeklyWeekDays:
        firstRule?.ruleMode === 'weekly_day' && firstRule.weekDays?.length
          ? firstRule.weekDays
          : DEFAULT_FORM.weeklyWeekDays,
      weeklyTime:
        firstRule?.ruleMode === 'weekly_day'
          ? firstRule.timeOfDay ?? '15:00'
          : DEFAULT_FORM.weeklyTime,
      monthlyMonthDay:
        firstRule?.ruleMode === 'monthly_day'
          ? firstRule.monthDay ?? 1
          : DEFAULT_FORM.monthlyMonthDay,
      monthlyTime:
        firstRule?.ruleMode === 'monthly_day'
          ? firstRule.timeOfDay ?? '09:00'
          : DEFAULT_FORM.monthlyTime,
      intervalMinutes:
        firstRule?.ruleMode === 'interval'
          ? firstRule.intervalMinutes ?? 30
          : DEFAULT_FORM.intervalMinutes,
      intervalUseWindow:
        firstRule?.ruleMode === 'interval' ? Boolean(firstRule.activeFrom) : false,
      intervalActiveFrom:
        firstRule?.ruleMode === 'interval' && firstRule.activeFrom
          ? firstRule.activeFrom
          : DEFAULT_FORM.intervalActiveFrom,
      intervalActiveUntil:
        firstRule?.ruleMode === 'interval' && firstRule.activeUntil
          ? firstRule.activeUntil
          : DEFAULT_FORM.intervalActiveUntil,
      intervalUseWeekdays:
        firstRule?.ruleMode === 'interval'
          ? (firstRule.weekDays?.length ?? 0) > 0
          : false,
      intervalWeekDays:
        firstRule?.ruleMode === 'interval' && firstRule.weekDays?.length
          ? firstRule.weekDays
          : DEFAULT_FORM.intervalWeekDays,
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

  function deleteReminder(id: string) {
    const target = reminders.find((reminder) => reminder.id === id);
    modals.openConfirmModal({
      title: '確定要刪除這則提醒？',
      centered: true,
      children: (
        <Text size="sm">
          將永久刪除「
          <Text component="span" fw={700}>
            {target?.title ?? '此提醒'}
          </Text>
          」，無法復原。
        </Text>
      ),
      labels: { confirm: '刪除', cancel: '取消' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        await fetch(`${API_BASE_URL}/reminders/${id}`, { method: 'DELETE' });
        setReminderGroupMap((prev) => {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        await fetchReminders();
      },
    });
  }

  async function toggleReminderEnabled(reminder: Reminder) {
    const nextEnabled = !reminder.enabled;
    // 樂觀更新：先在前端切，失敗時 revert，省掉 fetchReminders 造成的整列閃動
    setReminders((current) =>
      current.map((item) =>
        item.id === reminder.id ? { ...item, enabled: nextEnabled } : item,
      ),
    );
    const action = reminder.enabled ? 'disable' : 'enable';
    const response = await fetch(`${API_BASE_URL}/reminders/${reminder.id}/${action}`, {
      method: 'PATCH',
    });
    if (!response.ok) {
      setReminders((current) =>
        current.map((item) =>
          item.id === reminder.id ? { ...item, enabled: reminder.enabled } : item,
        ),
      );
      setMessage({ text: '更新啟用狀態失敗', tone: 'error' });
    }
  }

  function formatDateTimeForDisplay(value: string | null) {
    if (!value) return '未設定';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '未設定';
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const mi = String(date.getMinutes()).padStart(2, '0');
    return `${yyyy}/${mm}/${dd} ${hh}:${mi}`;
  }

  function describeReminderSchedule(reminder: Reminder) {
    if (reminder.scheduleType === 'one_time') {
      return `單次 · ${formatDateTimeForDisplay(reminder.oneTimeAt)}`;
    }
    const rule = reminder.recurrenceRules[0];
    if (!rule) return '重複';
    const weekNames = ['日', '一', '二', '三', '四', '五', '六'];
    if (rule.ruleMode === 'monthly_day') {
      return `每月 ${rule.monthDay ?? '?'} 號 ${rule.timeOfDay ?? ''}`.trim();
    }
    if (rule.ruleMode === 'weekly_day') {
      const days = (rule.weekDays ?? [])
        .slice()
        .sort((a, b) => a - b)
        .map((d) => weekNames[d] ?? '?')
        .join('、');
      return `每週 ${days || '?'} ${rule.timeOfDay ?? ''}`.trim();
    }
    if (rule.ruleMode === 'interval') {
      const m = rule.intervalMinutes ?? 0;
      const intervalLabel =
        m >= 60 && m % 60 === 0 ? `${m / 60} 小時` : `${m} 分鐘`;
      const parts = [`每隔 ${intervalLabel}`];
      if (rule.activeFrom && rule.activeUntil) {
        parts.push(`${rule.activeFrom}–${rule.activeUntil}`);
      }
      if (rule.weekDays && rule.weekDays.length > 0 && rule.weekDays.length < 7) {
        const days = rule.weekDays
          .slice()
          .sort((a, b) => a - b)
          .map((d) => weekNames[d] ?? '?')
          .join('、');
        parts.push(`週${days}`);
      }
      return parts.join(' · ');
    }
    return `每日 ${rule.timeOfDay ?? '--:--'}`;
  }

  function isReminderExpired(reminder: Reminder) {
    if (reminder.scheduleType !== 'one_time') return false;
    if (!reminder.oneTimeAt) return false;
    const target = new Date(reminder.oneTimeAt).getTime();
    if (Number.isNaN(target)) return false;
    return target < Date.now();
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
    const count = reminders.filter((reminder) => reminderGroupMap[reminder.id] === groupName).length;
    modals.openConfirmModal({
      title: `確定要刪除群組「${groupName}」？`,
      centered: true,
      children: (
        <Text size="sm">
          {count > 0
            ? `群組內 ${count} 則提醒不會被刪除，會自動歸入「未分組」。`
            : '此群組目前沒有提醒。'}
        </Text>
      ),
      labels: { confirm: '刪除群組', cancel: '取消' },
      confirmProps: { color: 'red' },
      onConfirm: () => {
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
      },
    });
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

  function getGroupOf(id: string) {
    const mapped = reminderGroupMap[id];
    if (mapped && groupNames.includes(mapped)) return mapped;
    return '未分組';
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveDragId(event.active.id as string);
  }

  function handleDragCancel() {
    setActiveDragId(null);
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveDragId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    if (getGroupOf(active.id as string) !== getGroupOf(over.id as string)) return;

    const oldIndex = reminders.findIndex((item) => item.id === active.id);
    const newIndex = reminders.findIndex((item) => item.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const reordered = arrayMove(reminders, oldIndex, newIndex);
    setReminders(reordered);

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
    <Box component="main" p="md" mih="100vh">
      {message ? (
        <Notification
          color={message.tone === 'success' ? 'teal' : 'red'}
          radius="md"
          withCloseButton={message.tone === 'error'}
          onClose={() => setMessage(null)}
          style={{
            position: 'fixed',
            top: 18,
            right: 18,
            zIndex: 10000,
            maxWidth: 360,
            boxShadow: 'var(--mantine-shadow-md)',
          }}
        >
          <Group gap="xs" wrap="nowrap" align="center">
            <Text size="sm" style={{ flex: 1 }}>{message.text}</Text>
            {message.onRetry ? (
              <ActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                onClick={() => { setMessage(null); message.onRetry?.(); }}
              >
                <RotateCcw size={14} />
              </ActionIcon>
            ) : null}
          </Group>
        </Notification>
      ) : null}

      <Box style={{ display: 'flex', alignItems: 'flex-start' }}>
        {/* ── 側邊欄（sticky wrapper + Divider 放在一起，確保分隔線跟 sidebar 等高） ── */}
        <Box
          style={{
            position: 'sticky',
            top: 16,
            height: 'calc(100vh - 32px)',
            flexShrink: 0,
            display: 'flex',
          }}
        >
          <Box
            p="xs"
            style={{
              width: sidebarCollapsed ? 80 : 160,
              transition: 'width 0.22s cubic-bezier(0.22, 1, 0.36, 1)',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              height: '100%',
            }}
          >
          {/* 頂部 logo + 收合按鈕 */}
          <Group
            justify={sidebarCollapsed ? 'center' : 'space-between'}
            wrap="nowrap"
            mb="xs"
            px={2}
            style={{ minHeight: 36 }}
          >
            {sidebarCollapsed ? (
              <Tooltip label="展開側邊欄" position="right">
                <ActionIcon
                  variant="subtle"
                  color="indigo"
                  size="lg"
                  onClick={() => {
                    setSidebarCollapsed(false);
                    window.localStorage.setItem('remindme:sidebar-collapsed', '0');
                  }}
                >
                  <BellRing size={20} />
                </ActionIcon>
              </Tooltip>
            ) : (
              <>
                <Group gap={6} wrap="nowrap">
                  <BellRing size={18} color="var(--mantine-color-indigo-6)" />
                  <Text fw={700} c="indigo.7" size="sm" style={{ whiteSpace: 'nowrap' }}>
                    RemindMe
                  </Text>
                </Group>
                <Tooltip label="收合側邊欄">
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    size="sm"
                    onClick={() => {
                      setSidebarCollapsed(true);
                      window.localStorage.setItem('remindme:sidebar-collapsed', '1');
                    }}
                  >
                    <PanelLeftClose size={15} />
                  </ActionIcon>
                </Tooltip>
              </>
            )}
          </Group>

          {/* 導航項目 */}
          <Stack gap={4} style={{ flex: 1 }}>
            {sidebarCollapsed ? (
              <>
                <Tooltip label="顯示工具" position="right">
                  <ActionIcon
                    variant={activeTool === 'display' ? 'filled' : 'subtle'}
                    color="indigo"
                    size="lg"
                    style={{ width: '100%', borderRadius: 'var(--mantine-radius-md)' }}
                    onClick={() => { setActiveTool('display'); setDisplaySetting(savedDisplaySetting); }}
                  >
                    <Monitor size={17} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="任務工具" position="right">
                  <ActionIcon
                    variant={activeTool === 'task' ? 'filled' : 'subtle'}
                    color="indigo"
                    size="lg"
                    style={{ width: '100%', borderRadius: 'var(--mantine-radius-md)' }}
                    onClick={() => { setActiveTool('task'); setTaskView('list'); setDisplaySetting(savedDisplaySetting); }}
                  >
                    <ListTodo size={17} />
                  </ActionIcon>
                </Tooltip>
              </>
            ) : (
              <>
                <NavLink
                  label="顯示工具"
                  leftSection={<Monitor size={16} />}
                  active={activeTool === 'display'}
                  variant="filled"
                  color="indigo"
                  onClick={() => { setActiveTool('display'); setDisplaySetting(savedDisplaySetting); }}
                  styles={{ root: { borderRadius: 'var(--mantine-radius-md)' }, label: { whiteSpace: 'nowrap' } }}
                />
                <NavLink
                  label="任務工具"
                  leftSection={<ListTodo size={16} />}
                  active={activeTool === 'task'}
                  variant="filled"
                  color="indigo"
                  onClick={() => { setActiveTool('task'); setTaskView('list'); setDisplaySetting(savedDisplaySetting); }}
                  styles={{ root: { borderRadius: 'var(--mantine-radius-md)' }, label: { whiteSpace: 'nowrap' } }}
                />
              </>
            )}
          </Stack>

          {/* 底部：載入狀態 + 暗色切換 */}
          <Stack gap={4} pt="xs" align="center">
            {statusText && !sidebarCollapsed ? (
              <Text c="dimmed" size="xs">{statusText}</Text>
            ) : null}
            <Tooltip label={colorScheme === 'dark' ? '切換為亮色模式' : '切換為暗色模式'} position="right">
              <ActionIcon
                variant="subtle"
                color="gray"
                size="md"
                onClick={() => setColorScheme(colorScheme === 'dark' ? 'light' : 'dark')}
              >
                {colorScheme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
              </ActionIcon>
            </Tooltip>
          </Stack>
          </Box>

          <Divider orientation="vertical" />
        </Box>

        {/* ── 內容區 ── */}
        <Box p="md" style={{ flex: 1, minWidth: 0 }}>
          {activeTool === 'display' ? (
            <DisplayPanel
              displaySetting={displaySetting}
              onChange={setDisplaySetting}
              onSave={() => void saveDisplaySetting()}
              form={form}
            />
          ) : taskView === 'list' ? (
            <Stack gap="md">
                <Stack gap="sm">
                  <Button
                    fullWidth
                    variant="default"
                    leftSection={<Plus size={16} />}
                    onClick={() => {
                      setShowCreateGroup((prev) => !prev);
                      setNewGroupName('');
                    }}
                    styles={{
                      root: {
                        borderStyle: 'dashed',
                        borderColor: 'var(--mantine-color-indigo-3)',
                        background: 'var(--mantine-color-indigo-light)',
                        color: 'var(--mantine-color-indigo-7)',
                        fontWeight: 600,
                      },
                    }}
                  >
                    新增任務群組
                  </Button>
                  {showCreateGroup ? (
                    <Group gap="xs" wrap="nowrap">
                      <TextInput
                        style={{ flex: 1 }}
                        placeholder="未命名群組"
                        value={newGroupName}
                        autoFocus
                        onChange={(event) => setNewGroupName(event.currentTarget.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            createGroup();
                          } else if (event.key === 'Escape') {
                            event.preventDefault();
                            setShowCreateGroup(false);
                            setNewGroupName('');
                          }
                        }}
                      />
                      <Button variant="default" onClick={() => setShowCreateGroup(false)}>
                        取消
                      </Button>
                      <Button onClick={createGroup}>建立</Button>
                    </Group>
                  ) : null}
                </Stack>

                {groups.length === 0 ? (
                  <Paper className="surface-subtle" radius="md" p="xl">
                    <Stack gap="sm" align="center" ta="center">
                      <ThemeIcon size={56} radius="xl" variant="light" color="indigo">
                        <BellPlus size={28} />
                      </ThemeIcon>
                      <div>
                        <Text fw={700} size="md">
                          還沒有任何提醒
                        </Text>
                        <Text c="dimmed" size="sm" mt={4}>
                          可以直接新增第一則提醒，或先建立群組做分類管理。
                        </Text>
                      </div>
                      <Group gap="xs" mt={4}>
                        <Button
                          leftSection={<Plus size={14} />}
                          onClick={() => createReminderInGroup('未分組')}
                        >
                          立即新增提醒
                        </Button>
                        <Button
                          variant="default"
                          leftSection={<Plus size={14} />}
                          onClick={() => {
                            setShowCreateGroup(true);
                            setNewGroupName('');
                          }}
                        >
                          建立群組
                        </Button>
                      </Group>
                    </Stack>
                  </Paper>
                ) : null}
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  // 關掉水平 autoscroll：cursor 拖到右邊時不要把畫面整個往右捲，
                  // 避免看到 body 邊界外的空白；垂直保留 0.2 讓長列表能自動捲動
                  autoScroll={{ threshold: { x: 0, y: 0.2 } }}
                  // 強制兩種 measure 都用真實 getBoundingClientRect，並每次拖曳都重新量。
                  // 預設的 measure 會被 ancestor 的 transform/containing block 干擾
                  // （globals.css 的 surface-fade-in animation+both 在 surface 元素上殘留
                  // transform: translateY(0)，這雖然視覺等於沒位移，但會建立新的 containing
                  // block，使 dnd-kit 內部 rect 計算偏移到「左欄寬度」的位置）。
                  measuring={{
                    draggable: { measure: getRectFromNode },
                    droppable: {
                      strategy: MeasuringStrategy.Always,
                      measure: getRectFromNode,
                    },
                  }}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  onDragCancel={handleDragCancel}
                >
                  {groups.map((group) => (
                  <Paper key={group.name} className="surface" radius="md" p="md">
                    <Stack gap="sm">
                      <Group justify="space-between" align="center" wrap="nowrap">
                        {editingGroupName === group.name ? (
                          <TextInput
                            size="sm"
                            style={{ flex: 1 }}
                            value={editingGroupValue}
                            autoFocus
                            onChange={(event) => setEditingGroupValue(event.currentTarget.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                renameGroup(group.name);
                              } else if (event.key === 'Escape') {
                                event.preventDefault();
                                setEditingGroupName(null);
                                setEditingGroupValue('');
                              }
                            }}
                          />
                        ) : (
                          <Text fw={700}>
                            {group.name}
                          </Text>
                        )}
                        {group.name !== '未分組' ? (
                          <Group gap={4} wrap="nowrap">
                            {editingGroupName === group.name ? (
                              <>
                                <Button
                                  size="xs"
                                  variant="default"
                                  onClick={() => {
                                    setEditingGroupName(null);
                                    setEditingGroupValue('');
                                  }}
                                >
                                  取消
                                </Button>
                                <Button size="xs" onClick={() => renameGroup(group.name)}>
                                  儲存
                                </Button>
                              </>
                            ) : (
                              <>
                                <Tooltip label="編輯群組名稱">
                                  <ActionIcon
                                    variant="subtle"
                                    color="gray"
                                    onClick={() => {
                                      setEditingGroupName(group.name);
                                      setEditingGroupValue(group.name);
                                    }}
                                  >
                                    <PenLine size={14} />
                                  </ActionIcon>
                                </Tooltip>
                                <Tooltip label="刪除群組">
                                  <ActionIcon
                                    variant="subtle"
                                    color="red"
                                    onClick={() => deleteGroup(group.name)}
                                  >
                                    <Trash2 size={14} />
                                  </ActionIcon>
                                </Tooltip>
                              </>
                            )}
                          </Group>
                        ) : null}
                      </Group>

                      <Button
                        variant="subtle"
                        size="sm"
                        leftSection={<Plus size={14} />}
                        onClick={() => createReminderInGroup(group.name)}
                        style={{ alignSelf: 'flex-start' }}
                      >
                        新增提醒
                      </Button>

                      {group.items.length === 0 ? (
                        <Text c="dimmed" size="sm" pl="xs">
                          此群組目前無提醒項目
                        </Text>
                      ) : (
                        <SortableContext
                          items={group.items.map((item) => item.id)}
                          strategy={verticalListSortingStrategy}
                        >
                          <Stack gap="xs">
                            {group.items.map((item) => (
                              <SortableReminderRow
                                key={item.id}
                                id={item.id}
                                title={item.title}
                                scheduleSummary={describeReminderSchedule(item)}
                                enabled={item.enabled}
                                expired={isReminderExpired(item)}
                                onToggle={() => void toggleReminderEnabled(item)}
                                onEdit={() => {
                                  setSelectedGroup(group.name);
                                  beginEdit(item);
                                }}
                                onDelete={() => deleteReminder(item.id)}
                              />
                            ))}
                          </Stack>
                        </SortableContext>
                      )}
                    </Stack>
                  </Paper>
                  ))}
                  <DragOverlay dropAnimation={dropAnimation} zIndex={10000}>
                    {activeReminder ? (
                      <ReminderRowOverlay
                        title={activeReminder.title}
                        scheduleSummary={describeReminderSchedule(activeReminder)}
                        enabled={activeReminder.enabled}
                        expired={isReminderExpired(activeReminder)}
                      />
                    ) : null}
                  </DragOverlay>
                </DndContext>
            </Stack>
          ) : (
            <Stack gap="md">
              <Tooltip label="返回列表">
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="md"
                  onClick={() => {
                    setTaskView('list');
                    setEditingId(null);
                  }}
                >
                  <ArrowLeft size={18} />
                </ActionIcon>
              </Tooltip>
              <TaskForm
                form={form}
                isEditing={isEditing}
                onSubmit={handleSubmit}
                onCancelEdit={cancelEdit}
                onChange={setForm}
              />
            </Stack>
          )}
        </Box>
      </Box>

    </Box>
  );
}
