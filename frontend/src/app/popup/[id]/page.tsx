'use client';

import { use, useEffect, useState, useRef } from 'react';
import { Box, Text, Button, Group, Progress, Stack } from '@mantine/core';
import { BellRing, Sparkles, CalendarClock, X, Clock } from 'lucide-react';

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

const sizeMap = { small: 108, medium: 144, large: 182 };

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
  const [reminder, setReminder] = useState<Reminder | null>(null);
  const [display, setDisplay] = useState<DisplaySetting | null>(null);
  const [progress, setProgress] = useState(100);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const iconSize = sizeMap[display.size] * 0.4;

  return (
    <Box
      style={{
        width: '100vw',
        height: '100vh',
        background: 'rgba(238, 242, 255, 0.85)',
        backdropFilter: 'blur(40px)',
        border: '1px solid rgba(199, 210, 254, 0.6)',
        borderRadius: 16,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        userSelect: 'none',
        cursor: 'default',
      }}
    >
      <Group justify="space-between" align="flex-start">
        <MascotIcon icon={display.mascotIcon} size={iconSize} />
        <Button
          variant="subtle"
          size="compact-xs"
          color="gray"
          onClick={closeWindow}
          style={{ padding: 4 }}
        >
          <X size={14} />
        </Button>
      </Group>

      <Stack gap={4} style={{ flex: 1 }}>
        <Text fw={600} size="sm" lineClamp={2}>
          {reminder.title}
        </Text>
        {display.showContent && reminder.content && (
          <Text size="xs" c="dimmed" lineClamp={3}>
            {reminder.content}
          </Text>
        )}
      </Stack>

      {reminder.autoCloseEnabled && (
        <Progress value={progress} size="xs" color="indigo" />
      )}

      <Group gap={8} justify="flex-end">
        <Button
          variant="light"
          size="compact-sm"
          color="indigo"
          leftSection={<Clock size={12} />}
          onClick={handleSnooze}
        >
          延後 {Math.round(reminder.snoozeDefaultSeconds / 60)} 分
        </Button>
        <Button
          variant="filled"
          size="compact-sm"
          color="indigo"
          onClick={closeWindow}
        >
          關閉
        </Button>
      </Group>
    </Box>
  );
}
