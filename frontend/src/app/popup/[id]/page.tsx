'use client';

import { use, useEffect, useRef, useState } from 'react';
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

function MascotSvg({ icon, size }: { icon: string; size: number }) {
  const props = { size, strokeWidth: 1.5 };
  if (icon === 'sparkles') return <Sparkles {...props} />;
  if (icon === 'calendar_clock') return <CalendarClock {...props} />;
  return <BellRing {...props} />;
}

async function closeWindow() {
  try {
    const { getCurrentWindow } = await import(/* webpackIgnore: true */ '@tauri-apps/api/window');
    await getCurrentWindow().close();
  } catch {
    window.close();
  }
}

// font sizes per popup size
const TEXT_SIZE = { small: 11, medium: 12, large: 13 } as const;
const CONTENT_SIZE = { small: 10, medium: 11, large: 12 } as const;
const ICON_SIZE = { small: 13, medium: 14, large: 15 } as const;
const PADDING = { small: '8px 10px', medium: '10px 12px', large: '11px 14px' } as const;

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

  const sz = display.size;
  const isDark = display.theme === 'dark';

  const bg = isDark
    ? hovered ? 'rgba(18,14,48,0.95)' : 'rgba(18,14,48,0.55)'
    : hovered ? 'rgba(235,239,255,0.97)' : 'rgba(235,239,255,0.58)';

  const borderCol = isDark
    ? hovered ? 'rgba(129,140,248,0.55)' : 'rgba(99,102,241,0.25)'
    : hovered ? 'rgba(165,180,252,0.8)'  : 'rgba(199,210,254,0.5)';

  const textCol  = isDark ? 'rgba(235,235,255,0.95)' : 'rgba(28,24,72,0.92)';
  const dimCol   = isDark ? 'rgba(155,155,210,0.8)'  : 'rgba(99,102,241,0.68)';
  const iconCol  = isDark ? 'rgba(165,180,252,0.88)' : 'rgba(99,102,241,0.78)';
  const btnBg    = isDark ? 'rgba(99,102,241,0.8)'   : 'rgba(99,102,241,0.88)';
  const snoozeB  = isDark ? 'rgba(129,140,248,0.3)'  : 'rgba(199,210,254,0.8)';

  const fs    = TEXT_SIZE[sz];
  const fsc   = CONTENT_SIZE[sz];
  const isize = ICON_SIZE[sz];

  // shared: single-line, no wrap, ellipsis
  const nowrap: React.CSSProperties = {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'fixed',
        inset: 0,
        boxSizing: 'border-box',
        padding: PADDING[sz],
        background: bg,
        backdropFilter: 'blur(36px) saturate(180%)',
        WebkitBackdropFilter: 'blur(36px) saturate(180%)',
        border: `1px solid ${borderCol}`,
        borderRadius: 13,
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
        userSelect: 'none',
        cursor: 'default',
        transition: 'background 0.25s ease, border-color 0.25s ease',
        overflow: 'hidden',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {/* ── Header: [icon] [title …] [×] — all in one line ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: '0 0 auto' }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            flexShrink: 0,
            color: iconCol,
            lineHeight: 1,
          }}
        >
          <MascotSvg icon={display.mascotIcon} size={isize} />
        </span>

        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: fs,
            fontWeight: 700,
            color: textCol,
            lineHeight: 1.2,
            ...nowrap,
          }}
        >
          {reminder.title}
        </span>

        <button
          onClick={closeWindow}
          style={{
            flexShrink: 0,
            display: 'inline-flex',
            alignItems: 'center',
            padding: 2,
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            color: dimCol,
            borderRadius: 3,
            lineHeight: 1,
          }}
        >
          <X size={isize - 1} />
        </button>
      </div>

      {/* ── Content (optional, 1 line only) ── */}
      {display.showContent && reminder.content && (
        <div
          style={{
            fontSize: fsc,
            color: dimCol,
            lineHeight: 1.3,
            flex: '0 0 auto',
            ...nowrap,
          }}
        >
          {reminder.content}
        </div>
      )}

      {/* ── Footer ── */}
      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 4, flex: '0 0 auto' }}>
        {reminder.autoCloseEnabled && (
          <div
            style={{
              height: 2,
              borderRadius: 2,
              background: isDark ? 'rgba(129,140,248,0.18)' : 'rgba(199,210,254,0.55)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${progress}%`,
                background: isDark ? 'rgba(129,140,248,0.85)' : 'rgba(99,102,241,0.65)',
                transition: 'width 0.2s linear',
              }}
            />
          </div>
        )}

        <div style={{ display: 'flex', gap: 5, justifyContent: 'flex-end', alignItems: 'center' }}>
          <button
            onClick={handleSnooze}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
              fontSize: fsc,
              padding: '2px 7px',
              border: `1px solid ${snoozeB}`,
              borderRadius: 5,
              background: 'transparent',
              color: dimCol,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            <Clock size={fsc - 1} />
            延後 {Math.round(reminder.snoozeDefaultSeconds / 60)} 分
          </button>
          <button
            onClick={closeWindow}
            style={{
              fontSize: fsc,
              padding: '2px 9px',
              border: 'none',
              borderRadius: 5,
              background: btnBg,
              color: '#fff',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            關閉
          </button>
        </div>
      </div>
    </div>
  );
}
