'use client';

import { use, useEffect, useRef, useState } from 'react';
import { Button, Group, Progress, Stack, Text } from '@mantine/core';
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
  theme: 'light' | 'dark';
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

  const [reminder, setReminder] = useState<Reminder | null>(null);
  const [display, setDisplay] = useState<DisplaySetting | null>(null);
  const [progress, setProgress] = useState(100);
  const [hovered, setHovered] = useState(false);
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

  const isDark = display.theme === 'dark';

  const bg = isDark
    ? hovered ? 'rgba(18, 14, 48, 0.94)' : 'rgba(18, 14, 48, 0.52)'
    : hovered ? 'rgba(236, 240, 255, 0.96)' : 'rgba(236, 240, 255, 0.55)';

  const border = isDark
    ? hovered ? 'rgba(129, 140, 248, 0.5)' : 'rgba(99, 102, 241, 0.25)'
    : hovered ? 'rgba(165, 180, 252, 0.75)' : 'rgba(199, 210, 254, 0.5)';

  const textColor = isDark ? 'rgba(238, 238, 255, 0.95)' : 'rgba(30, 27, 75, 0.9)';
  const dimColor  = isDark ? 'rgba(160, 160, 210, 0.75)' : 'rgba(99, 102, 241, 0.65)';
  const iconColor = isDark ? 'rgba(165, 180, 252, 0.85)' : 'rgba(99, 102, 241, 0.75)';

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: '100vw',
        height: '100vh',
        boxSizing: 'border-box',
        background: bg,
        backdropFilter: 'blur(36px) saturate(180%)',
        WebkitBackdropFilter: 'blur(36px) saturate(180%)',
        border: `1px solid ${border}`,
        borderRadius: 14,
        padding: '10px 12px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
        userSelect: 'none',
        cursor: 'default',
        transition: 'background 0.25s ease, border-color 0.25s ease',
        overflow: 'hidden',
      }}
    >
      {/* Header row: icon + title + close — all inline */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
        <span style={{ color: iconColor, flexShrink: 0, display: 'flex', alignItems: 'center' }}>
          <MascotIcon icon={display.mascotIcon} size={15} />
        </span>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: 13,
            fontWeight: 600,
            color: textColor,
            lineHeight: 1.3,
          }}
        >
          {reminder.title}
        </span>
        <button
          onClick={closeWindow}
          style={{
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            padding: 3,
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            color: dimColor,
            borderRadius: 4,
          }}
        >
          <X size={12} />
        </button>
      </div>

      {/* Content */}
      {display.showContent && reminder.content && (
        <p
          style={{
            margin: 0,
            fontSize: 11,
            color: dimColor,
            lineHeight: 1.4,
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {reminder.content}
        </p>
      )}

      {/* Footer */}
      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 5 }}>
        {reminder.autoCloseEnabled && (
          <div style={{ height: 2, borderRadius: 2, background: isDark ? 'rgba(129,140,248,0.2)' : 'rgba(199,210,254,0.5)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${progress}%`, background: isDark ? 'rgba(129,140,248,0.8)' : 'rgba(99,102,241,0.6)', transition: 'width 0.2s linear' }} />
          </div>
        )}

        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <button
            onClick={handleSnooze}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 11,
              padding: '3px 8px',
              border: `1px solid ${isDark ? 'rgba(129,140,248,0.3)' : 'rgba(199,210,254,0.7)'}`,
              borderRadius: 6,
              background: 'transparent',
              color: dimColor,
              cursor: 'pointer',
            }}
          >
            <Clock size={10} />
            延後 {Math.round(reminder.snoozeDefaultSeconds / 60)} 分
          </button>
          <button
            onClick={closeWindow}
            style={{
              fontSize: 11,
              padding: '3px 10px',
              border: 'none',
              borderRadius: 6,
              background: isDark ? 'rgba(99,102,241,0.75)' : 'rgba(99,102,241,0.85)',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            關閉
          </button>
        </div>
      </div>
    </div>
  );
}
