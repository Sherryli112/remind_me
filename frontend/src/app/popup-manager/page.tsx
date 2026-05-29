// frontend/src/app/popup-manager/page.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import {
  BellRing, CalendarClock, ChevronsDown, ChevronsUp,
  Clock, Pointer, Sparkles,
} from 'lucide-react';
import { calcWindowHeight, CARD_HEIGHT, CARD_WIDTH } from './height';

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';

// ── Types ──────────────────────────────────────────────────────────────
type DueReminder = {
  id: string;
  title: string;
  content: string;
  autoCloseEnabled: boolean;
  autoCloseSeconds: number;
  snoozeDefaultSeconds: number;
  corner: string;
  size: 'small' | 'medium' | 'large';
  targetScreenId: string | null;
};

type DisplaySetting = {
  size: 'small' | 'medium' | 'large';
  theme: 'light' | 'dark';
  showContent: boolean;
  mascotIcon: 'bell_ring' | 'sparkles' | 'calendar_clock';
  corner: string;
  targetScreenId: string | null;
};

// ── Icon sizes ─────────────────────────────────────────────────────────
const ICON_SZ    = { small: 13, medium: 14, large: 15 } as const;
const TEXT_SZ    = { small: 11, medium: 12, large: 13 } as const;
const CONTENT_SZ = { small: 10, medium: 11, large: 12 } as const;
const PADDING    = { small: '8px 10px', medium: '10px 12px', large: '11px 14px' } as const;

// ── Sub-components ─────────────────────────────────────────────────────

function MascotIcon({ icon, size }: { icon: string; size: number }) {
  const p = { size, strokeWidth: 1.5 };
  if (icon === 'sparkles') return <Sparkles {...p} />;
  if (icon === 'calendar_clock') return <CalendarClock {...p} />;
  return <BellRing {...p} />;
}

function ArrowIndicator({ corner, onClick }: { corner: string; onClick: () => void }) {
  const isTop = corner.startsWith('top');
  const Icon = isTop ? ChevronsDown : ChevronsUp;
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        justifyContent: 'center',
        cursor: 'pointer',
        color: 'rgba(255,255,255,0.58)',
        animation: 'arrow-bob 1.5s ease-in-out infinite',
        lineHeight: 0,
        position: 'relative',
        zIndex: 10,
        // Overlap card edge by ~8px
        marginBottom: isTop ? 0 : -8,
        marginTop:    isTop ? -8 : 0,
      }}
    >
      <Icon size={22} strokeWidth={2.5} />
    </div>
  );
}

function CollapsedCard({
  reminder,
  display,
  onExpand,
}: {
  reminder: DueReminder;
  display: DisplaySetting;
  onExpand: () => void;
}) {
  const isDark = display.theme === 'dark';
  const sz = display.size;
  return (
    <div
      onClick={onExpand}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 12px',
        height: 36,
        borderRadius: 10,
        background: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(28,24,72,0.08)',
        backdropFilter: 'blur(8px)',
        border: isDark
          ? '1px solid rgba(255,255,255,0.12)'
          : '1px solid rgba(99,102,241,0.15)',
        cursor: 'pointer',
        userSelect: 'none',
        boxSizing: 'border-box',
        flexShrink: 0,
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <span style={{
        color: isDark ? 'rgba(165,180,252,0.88)' : 'rgba(99,102,241,0.78)',
        lineHeight: 1, flexShrink: 0,
      }}>
        <MascotIcon icon={display.mascotIcon} size={ICON_SZ[sz]} />
      </span>
      <span style={{
        fontSize: TEXT_SZ[sz],
        fontWeight: 600,
        color: isDark ? 'rgba(235,235,255,0.9)' : 'rgba(28,24,72,0.85)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {reminder.title}
      </span>
    </div>
  );
}

function ExpandedCard({
  reminder,
  display,
  onClose,
  onSnooze,
}: {
  reminder: DueReminder;
  display: DisplaySetting;
  onClose: () => void;
  onSnooze: () => void;
}) {
  const [progress, setProgress] = useState(100);
  const [hovered, setHovered] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!reminder.autoCloseEnabled) return;
    const total = reminder.autoCloseSeconds * 1000;
    const start = Date.now();
    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - start;
      setProgress(Math.max(0, 100 - (elapsed / total) * 100));
      if (elapsed >= total) {
        clearInterval(timerRef.current!);
        onClose();
      }
    }, 200);
    return () => clearInterval(timerRef.current!);
  }, [reminder.id, reminder.autoCloseEnabled, reminder.autoCloseSeconds, onClose]);

  const sz    = display.size;
  const isDark = display.theme === 'dark';
  const fs    = TEXT_SZ[sz];
  const fsc   = CONTENT_SZ[sz];
  const isize = ICON_SZ[sz];

  const bg        = isDark
    ? (hovered ? 'rgba(18,14,48,0.97)' : 'rgba(18,14,48,0.82)')
    : (hovered ? 'rgba(235,239,255,0.98)' : 'rgba(235,239,255,0.84)');
  const borderCol = isDark
    ? (hovered ? 'rgba(129,140,248,0.55)' : 'rgba(99,102,241,0.25)')
    : (hovered ? 'rgba(165,180,252,0.8)'  : 'rgba(199,210,254,0.5)');
  const textCol = isDark ? 'rgba(235,235,255,0.95)' : 'rgba(28,24,72,0.92)';
  const dimCol  = isDark ? 'rgba(155,155,210,0.8)'  : 'rgba(99,102,241,0.68)';
  const iconCol = isDark ? 'rgba(165,180,252,0.88)' : 'rgba(99,102,241,0.78)';
  const btnBg   = isDark ? 'rgba(99,102,241,0.8)'   : 'rgba(99,102,241,0.88)';
  const snoozeB = isDark ? 'rgba(129,140,248,0.3)'  : 'rgba(199,210,254,0.8)';

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        boxSizing: 'border-box',
        padding: PADDING[sz],
        background: bg,
        border: `1px solid ${borderCol}`,
        borderRadius: 13,
        boxShadow: '0 0 0 2px rgba(108,142,245,0.3), 0 6px 24px rgba(0,0,0,0.25)',
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
        userSelect: 'none',
        cursor: 'default',
        transition: 'background 0.25s ease, border-color 0.25s ease',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        flexShrink: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0, color: iconCol, lineHeight: 1 }}>
          <MascotIcon icon={display.mascotIcon} size={isize} />
        </span>
        <span style={{
          flex: 1, minWidth: 0, fontSize: fs, fontWeight: 700, color: textCol,
          lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {reminder.title}
        </span>
      </div>

      {display.showContent && reminder.content && (
        <div style={{
          fontSize: fsc, color: dimCol, lineHeight: 1.3,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {reminder.content}
        </div>
      )}

      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {reminder.autoCloseEnabled && (
          <div style={{ height: 2, borderRadius: 2, background: isDark ? 'rgba(129,140,248,0.18)' : 'rgba(199,210,254,0.55)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${progress}%`, background: isDark ? 'rgba(129,140,248,0.85)' : 'rgba(99,102,241,0.65)', transition: 'width 0.2s linear' }} />
          </div>
        )}
        <div style={{ display: 'flex', gap: 5, justifyContent: 'flex-end', alignItems: 'center' }}>
          <button onClick={onSnooze} style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            fontSize: fsc, padding: '2px 7px',
            border: `1px solid ${snoozeB}`, borderRadius: 5,
            background: 'transparent', color: dimCol, cursor: 'pointer', whiteSpace: 'nowrap',
          }}>
            <Clock size={fsc - 1} />
            延後 {Math.round(reminder.snoozeDefaultSeconds / 60)} 分
          </button>
          <button onClick={onClose} style={{
            fontSize: fsc, padding: '2px 9px', border: 'none',
            borderRadius: 5, background: btnBg, color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap',
          }}>
            關閉
          </button>
        </div>
      </div>
    </div>
  );
}

function ScrollHint() {
  const [hovered, setHovered] = useState(false);
  return (
    <div style={{
      position: 'absolute', bottom: 0, left: 0, right: 0,
      height: 56, pointerEvents: 'none',
      background: 'linear-gradient(to bottom, transparent, rgba(0,0,0,0.35))',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      paddingBottom: 4,
    }}>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
          opacity: hovered ? 1 : 0.45, transition: 'opacity 0.2s',
          pointerEvents: 'auto', cursor: 'default', color: 'white',
        }}
      >
        <Pointer size={16} strokeWidth={1.5} />
        <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>
          滑動查看更多
        </span>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────
export default function PopupManagerPage() {
  const [reminders, setReminders]   = useState<DueReminder[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [display, setDisplay]       = useState<DisplaySetting | null>(null);
  const [isOverflow, setIsOverflow] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Fetch display settings once
  useEffect(() => {
    fetch(`${API}/display-settings/current`)
      .then((r) => r.json() as Promise<DisplaySetting>)
      .then(setDisplay)
      .catch(() => {});
  }, []);

  // Subscribe to reminders-updated Tauri event
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    import('@tauri-apps/api/event')
      .then(({ listen }) =>
        listen<DueReminder[]>('reminders-updated', (e) => {
          const incoming = e.payload;
          setReminders(incoming);
          setExpandedId(incoming[0]?.id ?? null);
          setIsExpanded(false);
        })
      )
      .then((fn) => { unlisten = fn; })
      .catch(() => {});
    return () => unlisten?.();
  }, []);

  // Fetch initial pending reminders on mount (handles first-load race condition)
  useEffect(() => {
    import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke<DueReminder[]>('get_pending_reminders'))
      .then((pending) => {
        if (pending.length > 0) {
          setReminders(pending);
          setExpandedId(pending[0].id);
        }
      })
      .catch(() => {});
  }, []);

  // Resize + reposition window on state change
  useEffect(() => {
    if (!display) return;
    const { size, corner, targetScreenId } = display;
    const count = reminders.length;

    import('@tauri-apps/api/core').then(({ invoke }) => {
      if (count === 0) {
        invoke('hide_popup').catch(() => {});
        return;
      }
      const w = CARD_WIDTH[size];
      const h = calcWindowHeight(count, isExpanded, size, window.screen.availHeight);
      invoke('resize_popup', { width: w, height: h, corner, targetScreenId }).catch(() => {});
    }).catch(() => {});
  }, [reminders, isExpanded, display]);

  // Detect scroll overflow
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const check = () => setIsOverflow(el.scrollHeight > el.clientHeight + 4);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [reminders, isExpanded]);

  // Compute derived state before early return (needed for hook below)
  const activeId = expandedId ?? reminders[0]?.id ?? null;
  const expandedReminder = activeId ? (reminders.find((r) => r.id === activeId) ?? reminders[0]) : null;
  const collapsedReminders = expandedReminder
    ? reminders.filter((r) => r.id !== expandedReminder.id)
    : [];

  function removeReminder(id: string) {
    setReminders((prev) => {
      const next = prev.filter((r) => r.id !== id);
      if (next.length > 0) {
        setExpandedId((cur) =>
          next.find((r) => r.id === cur) ? cur : next[0].id
        );
      }
      return next;
    });
    setIsExpanded(false);
  }

  function handleClose(id: string) {
    removeReminder(id);
  }

  async function handleSnooze(id: string, seconds: number) {
    try {
      await fetch(`${API}/reminders/${id}/snooze`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seconds }),
      });
    } catch {}
    removeReminder(id);
  }

  // Auto-close collapsed cards that have autoCloseEnabled
  // Must be before the early return to satisfy Rules of Hooks
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    collapsedReminders.forEach((r) => {
      if (!r.autoCloseEnabled) return;
      const timer = setTimeout(() => handleClose(r.id), r.autoCloseSeconds * 1000);
      timers.push(timer);
    });
    return () => timers.forEach(clearTimeout);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsedReminders.map((r) => r.id).join(',')]);

  if (!display || reminders.length === 0) return null;

  const isTop = display.corner.startsWith('top');
  const showArrow = reminders.length > 1 && !isExpanded;

  // Card order: priority (expanded) first — justifyContent handles corner alignment
  const cardList = [expandedReminder!, ...collapsedReminders];

  return (
    <div style={{
      position: 'fixed', inset: 0,
      display: 'flex', flexDirection: 'column',
      justifyContent: isTop ? 'flex-start' : 'flex-end',
    }}>
      {/* ── Collapsed view ── */}
      {!isExpanded && (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {showArrow && !isTop && (
            <ArrowIndicator corner={display.corner} onClick={() => setIsExpanded(true)} />
          )}
          <ExpandedCard
            reminder={expandedReminder!}
            display={display}
            onClose={() => handleClose(expandedReminder!.id)}
            onSnooze={() => handleSnooze(expandedReminder!.id, expandedReminder!.snoozeDefaultSeconds)}
          />
          {showArrow && isTop && (
            <ArrowIndicator corner={display.corner} onClick={() => setIsExpanded(true)} />
          )}
        </div>
      )}

      {/* ── Expanded panel ── */}
      {isExpanded && (
        <div style={{ position: 'relative' }}>
          <div
            ref={scrollRef}
            style={{
              display: 'flex', flexDirection: 'column', gap: 6,
              overflowY: 'scroll', scrollbarWidth: 'none',
              maxHeight: `calc(100vh - 8px)`,
              padding: '4px 0',
            }}
          >
            {cardList.map((r) =>
              r.id === expandedReminder!.id ? (
                <ExpandedCard
                  key={r.id}
                  reminder={r}
                  display={display}
                  onClose={() => handleClose(r.id)}
                  onSnooze={() => handleSnooze(r.id, r.snoozeDefaultSeconds)}
                />
              ) : (
                <CollapsedCard
                  key={r.id}
                  reminder={r}
                  display={display}
                  onExpand={() => setExpandedId(r.id)}
                />
              )
            )}
          </div>
          {isOverflow && <ScrollHint />}
        </div>
      )}
    </div>
  );
}
