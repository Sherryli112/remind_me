'use client';

import { use, useEffect, useRef, useState } from 'react';
import { Box, Button, Group, Progress, Stack, Text } from '@mantine/core';
import { useComputedColorScheme } from '@mantine/core';
import { BellRing, CalendarClock, Clock, Sparkles, X } from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';

type Reminder = {
  id: string;
  title: string;
  content: string;
  autoCloseEnabled: boolean;
  autoCloseSeconds: number;
  snoozeDefaultSeconds: number;
};

type DisplaySetting = {
  size: 'small' | 'medium' | 'large';
  showContent: boolean;
  mascotIcon: 'bell_ring' | 'sparkles' | 'calendar_clock';
};

const MascotIcon = ({ icon, size }: { icon: string; size: number }) => {
  const props = { size, strokeWidth: 1.5 };
  if (icon === 'sparkles') return <Sparkles {...props} />;
  if (icon === 'calendar_clock') return <CalendarClock {...props} />;
  return <BellRing {...props} />;
};

async function closeWindow() {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().close();
  } catch {
    window.close();
  }
}

export default function PopupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const colorScheme = useComputedColorScheme('light');
  const isDark = colorScheme === 'dark';

  const [reminder, setReminder] = useState<Reminder | null>(null);
  const [display, setDisplay] = useState<DisplaySetting | null>(null);
  const [progress, setProgress] = useState(100);
  const [hovered, setHovered] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Make html/body transparent so the rounded popup corners show the desktop
  useEffect(() => {
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
  }, []);

  useEffect(() => {
    Promise.all([
      fetch(`${API}/reminders/${id}`).then((r) => r.json()),
      fetch(`${API}/display-settings/current`).then((r) => r.json()),
    ]).then(([r, d]) => {
      setReminder(r);
      setDisplay(d);
    });
  }, [id]);

  useEffect(() => {
    if (!reminder?.autoCloseEnabled) return;
    const total = reminder.autoCloseSeconds * 1000;
    const start = Date.now();
    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - start;
      const pct = Math.max(0, 100 - (elapsed / total) * 100);
      setProgress(pct);
      if (elapsed >= total) {
        clearInterval(timerRef.current!);
        closeWindow();
      }
    }, 200);
    return () => clearInterval(timerRef.current!);
  }, [reminder]);

  const handleSnooze = async () => {
    if (!reminder) return;
    await fetch(`${API}/reminders/${reminder.id}/snooze`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seconds: reminder.snoozeDefaultSeconds }),
    });
    await closeWindow();
  };

  if (!reminder || !display) return null;

  const lightBg = hovered ? 'rgba(236, 240, 255, 0.94)' : 'rgba(236, 240, 255, 0.52)';
  const darkBg = hovered ? 'rgba(18, 14, 48, 0.94)' : 'rgba(18, 14, 48, 0.52)';
  const lightBorder = hovered ? 'rgba(165, 180, 252, 0.7)' : 'rgba(199, 210, 254, 0.45)';
  const darkBorder = hovered ? 'rgba(129, 140, 248, 0.5)' : 'rgba(99, 102, 241, 0.25)';

  const textColor = isDark ? 'rgba(238, 238, 255, 0.92)' : 'rgba(30, 27, 75, 0.9)';
  const dimColor = isDark ? 'rgba(180, 180, 220, 0.7)' : 'rgba(79, 70, 229, 0.6)';

  return (
    <Box
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: '100vw',
        height: '100vh',
        background: isDark ? darkBg : lightBg,
        backdropFilter: 'blur(36px) saturate(180%)',
        WebkitBackdropFilter: 'blur(36px) saturate(180%)',
        border: `1px solid ${isDark ? darkBorder : lightBorder}`,
        borderRadius: 16,
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        userSelect: 'none',
        cursor: 'default',
        transition: 'background 0.25s ease, border-color 0.25s ease',
        overflow: 'hidden',
        boxSizing: 'border-box',
      }}
    >
      {/* Header: icon + title + close */}
      <Group gap={8} align="center" wrap="nowrap">
        <Box style={{ color: isDark ? 'rgba(165, 180, 252, 0.9)' : 'rgba(99, 102, 241, 0.8)', flexShrink: 0 }}>
          <MascotIcon icon={display.mascotIcon} size={18} />
        </Box>
        <Text
          fw={600}
          size="sm"
          lineClamp={1}
          style={{ flex: 1, color: textColor, minWidth: 0 }}
        >
          {reminder.title}
        </Text>
        <Button
          variant="subtle"
          size="compact-xs"
          onClick={closeWindow}
          style={{ padding: 4, flexShrink: 0, color: dimColor, minWidth: 'unset' }}
        >
          <X size={13} />
        </Button>
      </Group>

      {/* Content */}
      {display.showContent && reminder.content && (
        <Text size="xs" lineClamp={3} style={{ color: dimColor }}>
          {reminder.content}
        </Text>
      )}

      <Stack gap={6} style={{ marginTop: 'auto' }}>
        {reminder.autoCloseEnabled && (
          <Progress
            value={progress}
            size="xs"
            color={isDark ? 'indigo.4' : 'indigo'}
            style={{ opacity: 0.7 }}
          />
        )}

        <Group gap={6} justify="flex-end">
          <Button
            variant="subtle"
            size="compact-xs"
            leftSection={<Clock size={11} />}
            onClick={handleSnooze}
            style={{ color: dimColor, fontSize: 11 }}
          >
            延後 {Math.round(reminder.snoozeDefaultSeconds / 60)} 分
          </Button>
          <Button
            variant={isDark ? 'light' : 'filled'}
            size="compact-xs"
            color="indigo"
            onClick={closeWindow}
            style={{ fontSize: 11 }}
          >
            關閉
          </Button>
        </Group>
      </Stack>
    </Box>
  );
}
