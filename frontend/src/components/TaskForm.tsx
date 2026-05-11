'use client';

import { FormEvent, useMemo } from 'react';
import {
  Button,
  Chip,
  Divider,
  Group,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { DateTimePicker, TimePicker } from '@mantine/dates';
import { Sparkles } from 'lucide-react';
import { StepperNumberInput } from './StepperNumberInput';

type RecurrenceMode = 'interval' | 'daily_time' | 'weekly_day' | 'monthly_day';
type ScheduleType = 'one_time' | 'recurring';

export type FormState = {
  title: string;
  content: string;
  scheduleType: ScheduleType;
  oneTimeAt: string;
  recurrenceMode: RecurrenceMode;
  // daily_time
  dailyTime: string;
  // weekly_day
  weeklyWeekDays: number[];
  weeklyTime: string;
  // monthly_day
  monthlyMonthDay: number;
  monthlyTime: string;
  // interval
  intervalMinutes: number;
  intervalUseWindow: boolean;
  intervalActiveFrom: string;
  intervalActiveUntil: string;
  intervalUseWeekdays: boolean;
  intervalWeekDays: number[];
  // common tail
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

const scheduleTypeOptions: { value: ScheduleType; label: string }[] = [
  { value: 'one_time', label: '單次時間' },
  { value: 'recurring', label: '重複規則' },
];

const recurrenceModeOptions: { value: RecurrenceMode; label: string }[] = [
  { value: 'interval', label: '每隔一段' },
  { value: 'daily_time', label: '每天' },
  { value: 'weekly_day', label: '每週' },
  { value: 'monthly_day', label: '每月' },
];

const weekDayDefs: { value: number; label: string; full: string }[] = [
  { value: 1, label: '一', full: '週一' },
  { value: 2, label: '二', full: '週二' },
  { value: 3, label: '三', full: '週三' },
  { value: 4, label: '四', full: '週四' },
  { value: 5, label: '五', full: '週五' },
  { value: 6, label: '六', full: '週六' },
  { value: 0, label: '日', full: '週日' },
];

const monthDayOptions = Array.from({ length: 31 }, (_, i) => ({
  value: String(i + 1),
  label: `${i + 1} 號`,
}));

type Preset = {
  key: string;
  label: string;
  apply: (form: FormState) => FormState;
  match: (form: FormState) => boolean;
};

const arraysEqual = (a: number[], b: number[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

const presets: Preset[] = [
  {
    key: 'every-morning',
    label: '每天 09:00',
    apply: (form) => ({
      ...form,
      scheduleType: 'recurring',
      recurrenceMode: 'daily_time',
      dailyTime: '09:00',
    }),
    match: (form) =>
      form.scheduleType === 'recurring' &&
      form.recurrenceMode === 'daily_time' &&
      form.dailyTime === '09:00',
  },
  {
    key: 'weekdays-15',
    label: '每週一 15:00',
    apply: (form) => ({
      ...form,
      scheduleType: 'recurring',
      recurrenceMode: 'weekly_day',
      weeklyWeekDays: [1],
      weeklyTime: '15:00',
    }),
    match: (form) =>
      form.scheduleType === 'recurring' &&
      form.recurrenceMode === 'weekly_day' &&
      arraysEqual(form.weeklyWeekDays, [1]) &&
      form.weeklyTime === '15:00',
  },
  {
    key: 'first-of-month',
    label: '每月 1 號 09:00',
    apply: (form) => ({
      ...form,
      scheduleType: 'recurring',
      recurrenceMode: 'monthly_day',
      monthlyMonthDay: 1,
      monthlyTime: '09:00',
    }),
    match: (form) =>
      form.scheduleType === 'recurring' &&
      form.recurrenceMode === 'monthly_day' &&
      form.monthlyMonthDay === 1 &&
      form.monthlyTime === '09:00',
  },
  {
    key: 'every-30',
    label: '每 30 分鐘',
    apply: (form) => ({
      ...form,
      scheduleType: 'recurring',
      recurrenceMode: 'interval',
      intervalMinutes: 30,
      intervalUseWindow: false,
      intervalUseWeekdays: false,
    }),
    match: (form) =>
      form.scheduleType === 'recurring' &&
      form.recurrenceMode === 'interval' &&
      form.intervalMinutes === 30 &&
      !form.intervalUseWindow &&
      !form.intervalUseWeekdays,
  },
  {
    key: 'workday-water',
    label: '工作日 09–18 點 每 30 分',
    apply: (form) => ({
      ...form,
      scheduleType: 'recurring',
      recurrenceMode: 'interval',
      intervalMinutes: 30,
      intervalUseWindow: true,
      intervalActiveFrom: '09:00',
      intervalActiveUntil: '18:00',
      intervalUseWeekdays: true,
      intervalWeekDays: [1, 2, 3, 4, 5],
    }),
    match: (form) =>
      form.scheduleType === 'recurring' &&
      form.recurrenceMode === 'interval' &&
      form.intervalMinutes === 30 &&
      form.intervalUseWindow &&
      form.intervalActiveFrom === '09:00' &&
      form.intervalActiveUntil === '18:00' &&
      form.intervalUseWeekdays &&
      arraysEqual(form.intervalWeekDays, [1, 2, 3, 4, 5]),
  },
];

function toNumber(value: number | string, fallback: number) {
  if (typeof value === 'number') return value;
  if (value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function describeInterval(totalMinutes: number) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m} 分鐘`;
  if (m === 0) return `${h} 小時`;
  return `${h} 小時 ${m} 分鐘`;
}

// 'YYYY-MM-DDTHH:MM'（datetime-local 格式）↔ Mantine DateTimePicker 的 'YYYY-MM-DD HH:MM'
function toPickerDate(local: string): string | null {
  if (!local) return null;
  return local.replace('T', ' ');
}

function fromPickerDate(value: string | null): string {
  if (!value) return '';
  return value.replace(' ', 'T').slice(0, 16);
}

function describeDuration(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  if (m === 0) return `${s} 秒`;
  if (s === 0) return `${m} 分鐘`;
  return `${m} 分 ${s} 秒`;
}


export function TaskForm({ form, isEditing, onSubmit, onCancelEdit, onChange }: Props) {
  const showShortMonthWarning = useMemo(
    () => form.recurrenceMode === 'monthly_day' && form.monthlyMonthDay >= 29,
    [form.recurrenceMode, form.monthlyMonthDay],
  );

  return (
    <Paper className="surface-strong" radius="lg" p="lg">
      <Stack gap="md">
        <div>
          <Title order={3} fw={700} c="indigo.8">
            {isEditing ? '編輯提醒' : '新增提醒'}
          </Title>
          <Text size="sm" c="dimmed" mt={4}>
            設定提醒的內容、排程、自動關閉與稍後提醒。
          </Text>
        </div>

        <form onSubmit={onSubmit}>
          <Stack gap="md">
            <TextInput
              label="標題"
              placeholder="例如：提醒喝水"
              value={form.title}
              onChange={(event) => onChange({ ...form, title: event.currentTarget.value })}
              required
            />

            <Textarea
              label="內容"
              placeholder="補充提醒的細節（選填）"
              autosize
              minRows={3}
              maxRows={6}
              value={form.content}
              onChange={(event) => onChange({ ...form, content: event.currentTarget.value })}
            />

            <Divider label="排程" labelPosition="left" />

            <SegmentedControl
              fullWidth
              data={scheduleTypeOptions}
              value={form.scheduleType}
              onChange={(value) => onChange({ ...form, scheduleType: value as ScheduleType })}
            />

            {form.scheduleType === 'one_time' ? (
              <DateTimePicker
                label="提醒時間"
                placeholder="選擇日期與時間"
                valueFormat="YYYY/MM/DD HH:mm"
                value={toPickerDate(form.oneTimeAt)}
                onChange={(value) =>
                  onChange({ ...form, oneTimeAt: fromPickerDate(value) })
                }
                clearable
                required
                timePickerProps={{ withDropdown: true, format: '24h' }}
              />
            ) : (
              <Stack gap="md">
                <div>
                  <Group gap={6} mb={6} align="center">
                    <Sparkles size={13} color="var(--mantine-color-indigo-6)" />
                    <Text size="xs" c="dimmed">
                      快速套用
                    </Text>
                  </Group>
                  <Group gap="xs" wrap="wrap">
                    {presets.map((preset) => {
                      const active = preset.match(form);
                      return (
                        <Chip
                          key={preset.key}
                          size="xs"
                          variant={active ? 'filled' : 'light'}
                          color="indigo"
                          checked={active}
                          onClick={() => onChange(preset.apply(form))}
                        >
                          {preset.label}
                        </Chip>
                      );
                    })}
                  </Group>
                </div>

                <SegmentedControl
                  fullWidth
                  data={recurrenceModeOptions}
                  value={form.recurrenceMode}
                  onChange={(value) =>
                    onChange({ ...form, recurrenceMode: value as RecurrenceMode })
                  }
                />

                {form.recurrenceMode === 'daily_time' ? (
                  <TimePicker
                    label="每日時間"
                    withDropdown
                    format="24h"
                                        value={form.dailyTime}
                    onChange={(value) => onChange({ ...form, dailyTime: value.slice(0, 5) })}
                  />
                ) : null}

                {form.recurrenceMode === 'weekly_day' ? (
                  <>
                    <div>
                      <Text size="sm" fw={500} mb={6}>
                        在哪幾天？（可多選）
                      </Text>
                      <Chip.Group
                        multiple
                        value={form.weeklyWeekDays.map(String)}
                        onChange={(values) =>
                          onChange({
                            ...form,
                            weeklyWeekDays: (values as string[])
                              .map(Number)
                              .sort((a, b) => a - b),
                          })
                        }
                      >
                        <Group gap="xs" wrap="wrap">
                          {weekDayDefs.map((day) => (
                            <Chip key={day.value} value={String(day.value)} variant="light">
                              {day.full}
                            </Chip>
                          ))}
                        </Group>
                      </Chip.Group>
                      {form.weeklyWeekDays.length === 0 ? (
                        <Text size="xs" c="red.6" mt={4}>
                          至少選擇一天
                        </Text>
                      ) : null}
                    </div>
                    <TimePicker
                      label="什麼時間？"
                      withDropdown
                      format="24h"
                                            value={form.weeklyTime}
                      onChange={(value) => onChange({ ...form, weeklyTime: value.slice(0, 5) })}
                    />
                  </>
                ) : null}

                {form.recurrenceMode === 'monthly_day' ? (
                  <>
                    <Select
                      label="每月哪一天？"
                      data={monthDayOptions}
                      value={String(form.monthlyMonthDay)}
                      onChange={(value) =>
                        onChange({
                          ...form,
                          monthlyMonthDay: value ? Number(value) : form.monthlyMonthDay,
                        })
                      }
                      allowDeselect={false}
                      searchable
                    />
                    {showShortMonthWarning ? (
                      <Text size="xs" c="orange.7" mt={-4}>
                        ⚠ 短月（如 2 月、4 月小月）若無此日期，該月份會自動跳過提醒。
                      </Text>
                    ) : null}
                    <TimePicker
                      label="什麼時間？"
                      withDropdown
                      format="24h"
                                            value={form.monthlyTime}
                      onChange={(value) => onChange({ ...form, monthlyTime: value.slice(0, 5) })}
                    />
                  </>
                ) : null}

                {form.recurrenceMode === 'interval' ? (
                  <Stack gap="sm">
                    <div>
                      <Text size="sm" fw={500} mb={6}>
                        每隔多久觸發？
                      </Text>
                      <Group grow align="flex-start" wrap="wrap">
                        <StepperNumberInput
                          label="小時"
                          min={0}
                          max={24}
                          value={Math.floor(form.intervalMinutes / 60)}
                          onChange={(value) => {
                            const h = toNumber(value, Math.floor(form.intervalMinutes / 60));
                            const m = form.intervalMinutes % 60;
                            onChange({ ...form, intervalMinutes: h * 60 + m });
                          }}
                          allowDecimal={false}
                          clampBehavior="strict"
                        />
                        <StepperNumberInput
                          label="分鐘"
                          min={0}
                          max={59}
                          value={form.intervalMinutes % 60}
                          onChange={(value) => {
                            const m = toNumber(value, form.intervalMinutes % 60);
                            const h = Math.floor(form.intervalMinutes / 60);
                            onChange({ ...form, intervalMinutes: h * 60 + m });
                          }}
                          allowDecimal={false}
                          clampBehavior="strict"
                        />
                      </Group>
                      <Text
                        size="xs"
                        c={form.intervalMinutes < 1 ? 'red.6' : 'dimmed'}
                        mt={4}
                      >
                        {form.intervalMinutes < 1
                          ? '⚠ 至少要設 1 分鐘'
                          : `目前設定：每 ${describeInterval(form.intervalMinutes)} 觸發一次`}
                      </Text>
                    </div>

                    <Switch
                      labelPosition="left"
                      label="限定時段"
                      description="只在指定時間區間內觸發；不勾＝全天"
                      styles={{
                        body: { justifyContent: 'space-between', width: '100%' },
                        labelWrapper: { flex: 1 },
                      }}
                      checked={form.intervalUseWindow}
                      onChange={(event) =>
                        onChange({ ...form, intervalUseWindow: event.currentTarget.checked })
                      }
                    />
                    {form.intervalUseWindow ? (
                      <Group grow align="flex-start" wrap="wrap">
                        <TimePicker
                          label="時段起"
                          withDropdown
                          format="24h"
                                                    value={form.intervalActiveFrom}
                          onChange={(value) =>
                            onChange({ ...form, intervalActiveFrom: value.slice(0, 5) })
                          }
                        />
                        <TimePicker
                          label="時段迄"
                          withDropdown
                          format="24h"
                                                    value={form.intervalActiveUntil}
                          onChange={(value) =>
                            onChange({ ...form, intervalActiveUntil: value.slice(0, 5) })
                          }
                        />
                      </Group>
                    ) : null}

                    <Switch
                      labelPosition="left"
                      label="限定星期"
                      description="只在指定星期觸發；不勾＝每天"
                      styles={{
                        body: { justifyContent: 'space-between', width: '100%' },
                        labelWrapper: { flex: 1 },
                      }}
                      checked={form.intervalUseWeekdays}
                      onChange={(event) =>
                        onChange({ ...form, intervalUseWeekdays: event.currentTarget.checked })
                      }
                    />
                    {form.intervalUseWeekdays ? (
                      <Chip.Group
                        multiple
                        value={form.intervalWeekDays.map(String)}
                        onChange={(values) =>
                          onChange({
                            ...form,
                            intervalWeekDays: (values as string[])
                              .map(Number)
                              .sort((a, b) => a - b),
                          })
                        }
                      >
                        <Group gap="xs" wrap="wrap">
                          {weekDayDefs.map((day) => (
                            <Chip key={day.value} value={String(day.value)} variant="light">
                              {day.full}
                            </Chip>
                          ))}
                        </Group>
                      </Chip.Group>
                    ) : null}
                  </Stack>
                ) : null}
              </Stack>
            )}

            <Divider label="結束條件（選填）" labelPosition="left" />

            <Group grow align="flex-start" wrap="wrap">
              <DateTimePicker
                label="結束日期"
                placeholder="不限制請留空"
                valueFormat="YYYY/MM/DD HH:mm"
                value={toPickerDate(form.endAt)}
                onChange={(value) =>
                  onChange({ ...form, endAt: fromPickerDate(value) })
                }
                clearable
                timePickerProps={{ withDropdown: true, format: '24h' }}
              />
              <StepperNumberInput
                label="最大提醒次數"
                placeholder="不限制請留空"
                min={1}
                value={form.maxOccurrences === '' ? '' : Number(form.maxOccurrences)}
                onChange={(value) =>
                  onChange({
                    ...form,
                    maxOccurrences: value === '' ? '' : String(value),
                  })
                }
                allowDecimal={false}
              />
            </Group>

            <Divider label="提醒行為" labelPosition="left" />

            <Switch
              size="md"
              labelPosition="left"
              label="提醒彈窗自動關閉"
              description="關閉時手動點擊才會關掉；開啟後依下方秒數自動關閉。"
              styles={{
                body: { justifyContent: 'space-between', width: '100%' },
                labelWrapper: { flex: 1 },
              }}
              checked={form.autoCloseEnabled}
              onChange={(event) =>
                onChange({ ...form, autoCloseEnabled: event.currentTarget.checked })
              }
            />

            <div>
              <Text size="sm" fw={500} mb={6} c={form.autoCloseEnabled ? undefined : 'dimmed'}>
                自動關閉時長
              </Text>
              <Group grow align="flex-start" wrap="wrap">
                <StepperNumberInput
                  label="分"
                  min={0}
                  max={10}
                  value={Math.floor(form.autoCloseSeconds / 60)}
                  onChange={(value) => {
                    const m = toNumber(value, Math.floor(form.autoCloseSeconds / 60));
                    const s = form.autoCloseSeconds % 60;
                    onChange({ ...form, autoCloseSeconds: m * 60 + s });
                  }}
                  allowDecimal={false}
                  clampBehavior="strict"
                  disabled={!form.autoCloseEnabled}
                />
                <StepperNumberInput
                  label="秒"
                  min={0}
                  max={59}
                  value={form.autoCloseSeconds % 60}
                  onChange={(value) => {
                    const s = toNumber(value, form.autoCloseSeconds % 60);
                    const m = Math.floor(form.autoCloseSeconds / 60);
                    onChange({ ...form, autoCloseSeconds: m * 60 + s });
                  }}
                  allowDecimal={false}
                  clampBehavior="strict"
                  disabled={!form.autoCloseEnabled}
                />
              </Group>
              <Text
                size="xs"
                c={
                  !form.autoCloseEnabled
                    ? 'dimmed'
                    : form.autoCloseSeconds < 1 || form.autoCloseSeconds > 600
                      ? 'red.6'
                      : 'dimmed'
                }
                mt={4}
              >
                {form.autoCloseSeconds < 1
                  ? '⚠ 至少要設 1 秒'
                  : form.autoCloseSeconds > 600
                    ? '⚠ 最多 10 分鐘（600 秒）'
                    : `關閉前等待：${describeDuration(form.autoCloseSeconds)}`}
              </Text>
            </div>

            <div>
              <Text size="sm" fw={500} mb={6}>
                稍後提醒時長
              </Text>
              <Group grow align="flex-start" wrap="wrap">
                <StepperNumberInput
                  label="分"
                  min={0}
                  max={10}
                  value={Math.floor(form.snoozeDefaultSeconds / 60)}
                  onChange={(value) => {
                    const m = toNumber(value, Math.floor(form.snoozeDefaultSeconds / 60));
                    const s = form.snoozeDefaultSeconds % 60;
                    onChange({ ...form, snoozeDefaultSeconds: m * 60 + s });
                  }}
                  allowDecimal={false}
                  clampBehavior="strict"
                />
                <StepperNumberInput
                  label="秒"
                  min={0}
                  max={59}
                  value={form.snoozeDefaultSeconds % 60}
                  onChange={(value) => {
                    const s = toNumber(value, form.snoozeDefaultSeconds % 60);
                    const m = Math.floor(form.snoozeDefaultSeconds / 60);
                    onChange({ ...form, snoozeDefaultSeconds: m * 60 + s });
                  }}
                  allowDecimal={false}
                  clampBehavior="strict"
                />
              </Group>
              <Text
                size="xs"
                c={
                  form.snoozeDefaultSeconds < 60 || form.snoozeDefaultSeconds > 600
                    ? 'red.6'
                    : 'dimmed'
                }
                mt={4}
              >
                {form.snoozeDefaultSeconds < 60
                  ? '⚠ 至少要設 1 分鐘（60 秒）'
                  : form.snoozeDefaultSeconds > 600
                    ? '⚠ 最多 10 分鐘（600 秒）'
                    : `按下稍後後 ${describeDuration(form.snoozeDefaultSeconds)} 再提醒`}
              </Text>
            </div>

            <Group justify="flex-end" mt="sm">
              {isEditing ? (
                <Button variant="default" onClick={onCancelEdit} type="button">
                  取消編輯
                </Button>
              ) : null}
              <Button type="submit" radius="md">
                {isEditing ? '更新提醒' : '建立提醒'}
              </Button>
            </Group>
          </Stack>
        </form>
      </Stack>
    </Paper>
  );
}
