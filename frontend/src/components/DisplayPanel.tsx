'use client';

import type { ComponentType, CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import {
  Button,
  Group,
  Select,
  Stack,
  Switch,
  Text,
  Title,
  UnstyledButton,
} from '@mantine/core';
import { BellRing, CalendarClock, Sparkles } from 'lucide-react';
import type { FormState } from './TaskForm';

export type DisplaySetting = {
  id: string;
  size: 'small' | 'medium' | 'large';
  theme: 'light' | 'dark';
  corner: 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right';
  showContent: boolean;
  targetScreenId: string | null;
  mascotMode: 'system' | 'custom';
  mascotIcon: 'bell_ring' | 'sparkles' | 'calendar_clock';
};

type Props = {
  displaySetting: DisplaySetting | null;
  onChange: (next: DisplaySetting) => void;
  onSave: () => void;
  form?: FormState;
};

const sizeOptions = [
  { value: 'small', label: '小' },
  { value: 'medium', label: '中' },
  { value: 'large', label: '大' },
];

const themeOptions = [
  { value: 'light', label: '亮色' },
  { value: 'dark', label: '暗色' },
];

const cornerOptions = [
  { value: 'top_left', label: '左上' },
  { value: 'top_right', label: '右上' },
  { value: 'bottom_left', label: '左下' },
  { value: 'bottom_right', label: '右下' },
];

const popupWidthMap = { small: 80, medium: 108, large: 140 };

type MascotOption = { value: DisplaySetting['mascotIcon']; label: string; Icon: ComponentType<{ size?: number }> };

const mascotOptions: MascotOption[] = [
  { value: 'bell_ring', label: '鈴鐺', Icon: BellRing },
  { value: 'sparkles', label: '閃光', Icon: Sparkles },
  { value: 'calendar_clock', label: '日曆時鐘', Icon: CalendarClock },
];

function MonitorMockup({
  displaySetting,
  form,
}: {
  displaySetting: DisplaySetting;
  form?: FormState;
}) {
  const MASCOT_ICON_MAP: Record<DisplaySetting['mascotIcon'], React.ElementType> = {
    bell_ring: BellRing,
    sparkles: Sparkles,
    calendar_clock: CalendarClock,
  };
  const MascotIcon = MASCOT_ICON_MAP[displaySetting.mascotIcon];

  const isDark = displaySetting.theme === 'dark';
  const corner = displaySetting.corner;
  const popupW = popupWidthMap[displaySetting.size];

  const popupPos: CSSProperties = {
    position: 'absolute',
    width: popupW,
    ...(corner.includes('top') ? { top: 8 } : { bottom: 8 }),
    ...(corner.includes('left') ? { left: 8 } : { right: 8 }),
  };

  const popupBg = isDark
    ? 'linear-gradient(135deg, rgba(15,23,42,0.94) 0%, rgba(30,27,75,0.86) 100%)'
    : 'rgba(255,255,255,0.94)';
  const titleColor = isDark ? '#f1f5f9' : '#1e293b';
  const subtitleColor = isDark ? '#94a3b8' : '#64748b';
  const popupBorder = isDark
    ? '1px solid rgba(99,102,241,0.38)'
    : '1px solid rgba(199,210,254,0.85)';
  const btnSnoozeBg = isDark ? 'rgba(30,41,59,0.85)' : '#ffffff';
  const btnSnoozeBorder = isDark ? 'rgba(99,102,241,0.4)' : 'rgba(0,0,0,0.14)';
  const btnSnoozeColor = isDark ? '#e2e8f0' : '#374151';

  return (
    <Stack gap={0} align="center">
      {/* Monitor frame */}
      <div
        style={{
          width: '100%',
          maxWidth: 540,
          background: 'linear-gradient(180deg, #3f4756 0%, #2d3542 100%)',
          borderRadius: 12,
          padding: '10px 10px 7px',
          boxShadow:
            '0 0 0 1px rgba(255,255,255,0.06) inset, 0 6px 24px rgba(0,0,0,0.35)',
        }}
      >
        {/* Screen */}
        <div
          style={{
            width: '100%',
            aspectRatio: '16 / 9',
            background: isDark
              ? 'linear-gradient(160deg, #0f172a 0%, #1e1b4b 100%)'
              : 'linear-gradient(160deg, #e8edf5 0%, #d4dae6 100%)',
            borderRadius: 4,
            position: 'relative',
            overflow: 'hidden',
            border: '1px solid rgba(0,0,0,0.2)',
          }}
        >
          {/* Subtle desktop top-bar hint */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: 14,
              background: isDark
                ? 'rgba(15,23,42,0.7)'
                : 'rgba(255,255,255,0.6)',
              borderBottom: isDark
                ? '1px solid rgba(99,102,241,0.15)'
                : '1px solid rgba(0,0,0,0.06)',
            }}
          />

          {/* Mini popup */}
          <div
            style={{
              ...popupPos,
              background: popupBg,
              border: popupBorder,
              borderRadius: 8,
              padding: '7px 9px',
              backdropFilter: 'blur(10px)',
              WebkitBackdropFilter: 'blur(10px)',
              boxShadow: isDark
                ? '0 8px 24px rgba(0,0,0,0.55)'
                : '0 4px 18px rgba(79,70,229,0.18)',
            }}
          >
            {/* 吉祥物圖示 */}
            <div style={{ marginBottom: 4, color: titleColor }}>
              <MascotIcon size={12} />
            </div>
            <div
              style={{
                fontSize: 9.5,
                fontWeight: 700,
                color: titleColor,
                marginBottom: 3,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {form?.title || '提醒標題預覽'}
            </div>
            {displaySetting.showContent ? (
              <div
                style={{
                  fontSize: 7.5,
                  color: subtitleColor,
                  marginBottom: 7,
                  lineHeight: 1.45,
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {form?.content || '提醒內容說明文字'}
              </div>
            ) : (
              <div style={{ marginBottom: 4 }} />
            )}
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                style={{
                  flex: 1,
                  fontSize: 8,
                  padding: '3px 0',
                  border: `1px solid ${btnSnoozeBorder}`,
                  borderRadius: 4,
                  background: btnSnoozeBg,
                  color: btnSnoozeColor,
                  cursor: 'default',
                }}
              >
                稍後提醒
              </button>
              <button
                style={{
                  flex: 1,
                  fontSize: 8,
                  padding: '3px 0',
                  border: 'none',
                  borderRadius: 4,
                  background: '#6366f1',
                  color: '#ffffff',
                  cursor: 'default',
                }}
              >
                關閉提醒
              </button>
            </div>
          </div>
        </div>

        {/* Bottom bezel */}
        <div style={{ height: 5 }} />
      </div>

      {/* Stand neck */}
      <div
        style={{
          width: 34,
          height: 18,
          background: '#2d3542',
        }}
      />
      {/* Stand base */}
      <div
        style={{
          width: 96,
          height: 8,
          background: '#2d3542',
          borderRadius: '0 0 8px 8px',
          boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
        }}
      />
    </Stack>
  );
}

type MonitorOption = { value: string; label: string };

export function DisplayPanel({ displaySetting, onChange, onSave, form }: Props) {
  const [monitors, setMonitors] = useState<MonitorOption[]>([]);
  const [isTauri, setIsTauri] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { availableMonitors } = await import(/* webpackIgnore: true */ '@tauri-apps/api/window');
        const list = await availableMonitors();
        setIsTauri(true);
        setMonitors(
          list.map((m, i) => ({
            value: m.name ?? `monitor-${i}`,
            label: m.name
              ? `${m.name} (${m.size.width}×${m.size.height})`
              : `螢幕 ${i + 1} (${m.size.width}×${m.size.height})`,
          })),
        );
      } catch {
        // Not running in Tauri — leave isTauri false
      }
    })();
  }, []);

  return (
    <Stack gap="md">
        <div>
          <Title order={3} fw={700} c="indigo.8">
            顯示工具
          </Title>
          <Text size="sm" c="dimmed" mt={4}>
            調整提醒彈窗的尺寸、主題與顯示位置。
          </Text>
        </div>

        {!displaySetting ? (
          <Text c="dimmed">尚未載入，請稍候…</Text>
        ) : (
          <>
            <Group grow align="flex-start" wrap="wrap">
              <Select
                label="尺寸"
                data={sizeOptions}
                value={displaySetting.size}
                onChange={(value) =>
                  value
                    ? onChange({ ...displaySetting, size: value as DisplaySetting['size'] })
                    : undefined
                }
                allowDeselect={false}
              />
              <Select
                label="主題"
                data={themeOptions}
                value={displaySetting.theme}
                onChange={(value) =>
                  value
                    ? onChange({ ...displaySetting, theme: value as DisplaySetting['theme'] })
                    : undefined
                }
                allowDeselect={false}
              />
              <Select
                label="角落"
                data={cornerOptions}
                value={displaySetting.corner}
                onChange={(value) =>
                  value
                    ? onChange({ ...displaySetting, corner: value as DisplaySetting['corner'] })
                    : undefined
                }
                allowDeselect={false}
              />
            </Group>

            <Select
              label="目標螢幕"
              description={
                isTauri
                  ? '選擇彈窗要顯示在哪個螢幕上'
                  : '桌面殼層接通後啟用此欄位；屆時將自動列出可用螢幕供選擇'
              }
              placeholder={isTauri ? '（預設：主螢幕）' : '桌面版啟用後可選'}
              data={monitors}
              value={displaySetting.targetScreenId ?? null}
              onChange={(value) =>
                onChange({ ...displaySetting, targetScreenId: value ?? null })
              }
              disabled={!isTauri || monitors.length === 0}
              clearable
            />

            <Switch
              size="md"
              labelPosition="left"
              label="在彈窗中顯示內容文字"
              description="勾選：顯示標題 + 內容；取消勾選：只顯示標題。"
              styles={{
                body: { justifyContent: 'space-between', width: '100%' },
                labelWrapper: { flex: 1 },
              }}
              checked={displaySetting.showContent}
              onChange={(event) =>
                onChange({ ...displaySetting, showContent: event.currentTarget.checked })
              }
            />

            <div>
              <Text size="sm" fw={500} mb={6}>
                吉祥物圖示
              </Text>
              <Group gap="sm">
                {mascotOptions.map(({ value, label, Icon }) => {
                  const isSelected = displaySetting.mascotIcon === value;
                  return (
                    <UnstyledButton
                      key={value}
                      onClick={() => onChange({ ...displaySetting, mascotIcon: value })}
                      style={{
                        border: `2px solid ${isSelected ? 'var(--mantine-color-indigo-5)' : 'var(--mantine-color-default-border)'}`,
                        borderRadius: 8,
                        padding: '8px 14px',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 4,
                        background: isSelected ? 'var(--mantine-color-indigo-0)' : 'transparent',
                        minWidth: 72,
                      }}
                    >
                      <Icon size={20} />
                      <Text size="xs" c={isSelected ? 'indigo' : undefined}>
                        {label}
                      </Text>
                    </UnstyledButton>
                  );
                })}
              </Group>
            </div>

            <MonitorMockup displaySetting={displaySetting} form={form} />

            <Group justify="flex-end">
              <Button onClick={onSave} radius="md">
                儲存顯示設定
              </Button>
            </Group>
          </>
        )}
    </Stack>
  );
}
